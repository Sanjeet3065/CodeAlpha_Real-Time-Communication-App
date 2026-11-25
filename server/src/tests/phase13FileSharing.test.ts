/**
 * CONNECTLY — Phase 13 File Sharing Integration & Reliability Test Suite
 * Covers storage providers (Memory, Local, S3), validation (MIME, extensions, magic bytes, size),
 * direct uploads, presigned uploads, listing, download streaming, safe headers, deletion permissions,
 * waiting-room/outsider access rejection, dashboard integration, and LiveKit data-channel invariant.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { io as ClientSocket } from 'socket.io-client';
import { User } from '../models/User.model.js';
import { Meeting } from '../models/Meeting.model.js';
import { MeetingParticipant } from '../models/MeetingParticipant.model.js';
import { SharedFile } from '../models/SharedFile.model.js';
import crypto from 'node:crypto';
import os from 'node:os';
import { meetingRealtime } from '../realtime/meetingSocket.js';
import { chatRedisService } from '../services/chatRedis.service.js';
import { FileService } from '../services/file.service.js';
import { meetingService } from '../services/meeting.service.js';
import { livekitService } from '../services/livekit.service.js';
import { MemoryStorageProvider } from '../storage/memoryStorageProvider.js';
import { LocalStorageProvider } from '../storage/localStorageProvider.js';
import { S3StorageProvider } from '../storage/s3StorageProvider.js';
import { setStorageProvider } from '../storage/storageFactory.js';
import {
  validateOpenXmlPackage,
  validateZipPayloadSecurity,
  inspectZipArchive,
  validateStorageArchive,
} from '../utils/archiveValidation.js';
import {
  FileCleanupWorker,
  CLEANUP_LEASE_DURATION_MS,
} from '../services/fileCleanupWorker.service.js';
import {
  validateMagicBytes,
  sanitizeFilename,
} from '../schemas/file.schema.js';
import { hashPassword } from '../utils/password.js';
import { generateAccessToken } from '../utils/tokens.js';

describe('Phase 13 File Sharing Test Suite', () => {
  function createMockZipBuffer(
    entries: { name: string; content?: string; uncompressedSize?: number; compressedSize?: number }[],
    options?: {
      overrideEocdTotalEntries?: number;
      overrideEocdCdOffset?: number;
      overrideCdOffsetForIndex?: { index: number; offset: number };
      corruptLocalHeaderAt?: number;
    }
  ): Buffer {
    const parts: Buffer[] = [];
    const cdRecords: Buffer[] = [];
    let offset = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const dataBuf = Buffer.from(entry.content || '');
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const compSize = entry.compressedSize ?? dataBuf.length;
      const uncompSize = entry.uncompressedSize ?? dataBuf.length;

      // Local Header
      const localHeader = Buffer.alloc(30);
      const localSig = options?.corruptLocalHeaderAt === i ? 0x00000000 : 0x04034b50;
      localHeader.writeUInt32LE(localSig, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(0, 14);
      localHeader.writeUInt32LE(compSize, 18);
      localHeader.writeUInt32LE(uncompSize, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      parts.push(localHeader, nameBuf, dataBuf);

      // Central Directory Record
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0, 8);
      cd.writeUInt16LE(0, 10);
      cd.writeUInt16LE(0, 12);
      cd.writeUInt16LE(0, 14);
      cd.writeUInt32LE(0, 16);
      cd.writeUInt32LE(compSize, 20);
      cd.writeUInt32LE(uncompSize, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30);
      cd.writeUInt16LE(0, 32);
      cd.writeUInt16LE(0, 34);
      cd.writeUInt16LE(0, 36);
      cd.writeUInt32LE(0, 38);
      const entryLocalOffset = options?.overrideCdOffsetForIndex?.index === i
        ? options.overrideCdOffsetForIndex.offset
        : offset;
      cd.writeUInt32LE(entryLocalOffset, 42);

      cdRecords.push(cd, nameBuf);
      offset += 30 + nameBuf.length + dataBuf.length;
    }

    const cdOffset = options?.overrideEocdCdOffset !== undefined ? options.overrideEocdCdOffset : offset;
    let cdSize = 0;
    for (const c of cdRecords) cdSize += c.length;

    const totalEntries = options?.overrideEocdTotalEntries !== undefined ? options.overrideEocdTotalEntries : entries.length;

    // EOCD
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(totalEntries, 8);
    eocd.writeUInt16LE(totalEntries, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...parts, ...cdRecords, eocd]);
  }

  let server: http.Server;
  let serverPort: number;
  let memoryStorage: MemoryStorageProvider;
  let customFileService: FileService;

  let hostUser: any;
  let guestUser: any;
  let waitingUser: any;
  let outsiderUser: any;
  let hostToken: string;
  let guestToken: string;

  let meetingCode: string;
  let meetingId: string;
  const createdMeetingIds: mongoose.Types.ObjectId[] = [];

  before(async () => {
    try {
      process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
      process.env.LIVEKIT_API_KEY = 'devkey';
      process.env.LIVEKIT_API_SECRET = 'secret';

      const mongoUri =
        process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly_test_phase13_files';
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri);
      }

      memoryStorage = new MemoryStorageProvider();
      setStorageProvider(memoryStorage);
      customFileService = new FileService(memoryStorage);

      const passwordHash = await hashPassword('Phase13FilePass!2026');
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      hostUser = await User.create({
        email: `p13_host_${suffix}@example.com`,
        passwordHash,
        firstName: 'Priya',
        lastName: 'Host',
        avatarUrl: 'https://example.com/host.png',
        isEmailVerified: true,
      });
      hostToken = generateAccessToken({
        sub: hostUser._id.toString(),
        email: hostUser.email,
        firstName: hostUser.firstName,
        lastName: hostUser.lastName,
      });

      guestUser = await User.create({
        email: `p13_guest_${suffix}@example.com`,
        passwordHash,
        firstName: 'Rohan',
        lastName: 'Guest',
        avatarUrl: 'https://example.com/guest.png',
        isEmailVerified: true,
      });
      guestToken = generateAccessToken({
        sub: guestUser._id.toString(),
        email: guestUser.email,
        firstName: guestUser.firstName,
        lastName: guestUser.lastName,
      });

      waitingUser = await User.create({
        email: `p13_waiting_${suffix}@example.com`,
        passwordHash,
        firstName: 'Tanvi',
        lastName: 'Waiting',
        isEmailVerified: true,
      });

      outsiderUser = await User.create({
        email: `p13_outsider_${suffix}@example.com`,
        passwordHash,
        firstName: 'Karan',
        lastName: 'Outsider',
        isEmailVerified: true,
      });

      // Create a test meeting
      const meetRes = await meetingService.createMeeting(hostUser._id.toString(), {
        title: 'Phase 13 File Sharing Architecture Session',
        maxParticipants: 10,
        settings: { waitingRoomEnabled: true },
      });
      meetingCode = meetRes.meeting.meetingCode;
      meetingId = meetRes.meeting.id;
      createdMeetingIds.push(new mongoose.Types.ObjectId(meetRes.meeting.id));

      // Host joins as participant
      await meetingService.joinMeeting(meetingCode, hostUser._id.toString(), {
        displayName: 'Priya Host',
      });

      // Guest joins and is admitted
      await meetingService.joinMeeting(meetingCode, guestUser._id.toString(), {
        displayName: 'Rohan Guest',
      });
      await meetingService.admitParticipant(
        meetingCode,
        hostUser._id.toString(),
        guestUser._id.toString()
      );

      // Waiting user joins and remains waiting
      await meetingService.joinMeeting(meetingCode, waitingUser._id.toString(), {
        displayName: 'Tanvi Waiting',
      });

      // Start in-memory HTTP server and attach Socket.IO hub
      server = http.createServer();
      meetingRealtime.attach(server);
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          serverPort = addr.port;
          resolve();
        });
      });
    } catch (err) {
      console.error('CRITICAL BEFORE HOOK ERROR:', err);
      throw err;
    }
  });

  beforeEach(() => {
    chatRedisService.clearLocalState();
  });

  after(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (meetingRealtime) {
        await meetingRealtime.close();
      }
      if (mongoose.connection.readyState !== 0) {
        await User.deleteMany({
          _id: { $in: [hostUser?._id, guestUser?._id, waitingUser?._id, outsiderUser?._id] },
        });
        await Meeting.deleteMany({ _id: { $in: createdMeetingIds } });
        await MeetingParticipant.deleteMany({ meetingId: { $in: createdMeetingIds } });
        await SharedFile.deleteMany({ meetingId: { $in: createdMeetingIds } });
        await mongoose.disconnect();
      }
    } catch {
      // Ignored
    }
  });

  // 1. Storage Abstraction Tests
  describe('1. Storage Provider Abstraction & Security Boundaries', () => {
    it('1.1 MemoryStorageProvider stores, streams, checks existence, and deletes objects correctly', async () => {
      const provider = new MemoryStorageProvider();
      const testBuffer = Buffer.from('Hello CONNECTLY File Sharing!');
      await provider.uploadStream('test/doc.txt', Readable.from(testBuffer), 'text/plain', testBuffer.length);

      const head = await provider.headObject('test/doc.txt');
      assert.ok(head);
      assert.strictEqual(head.exists, true);
      assert.strictEqual(head.sizeBytes, testBuffer.length);

      const download = await provider.downloadStream('test/doc.txt');
      assert.strictEqual(download.contentType, 'text/plain');

      const chunks: Buffer[] = [];
      for await (const chunk of download.stream) {
        chunks.push(Buffer.from(chunk));
      }
      const downloadedContent = Buffer.concat(chunks).toString('utf-8');
      assert.strictEqual(downloadedContent, 'Hello CONNECTLY File Sharing!');

      await provider.deleteObject('test/doc.txt');
      const headAfterDelete = await provider.headObject('test/doc.txt');
      assert.strictEqual(headAfterDelete, null);
    });

    it('1.2 LocalStorageProvider strictly blocks path traversal attacks (.. / directory escape)', async () => {
      const localProvider = new LocalStorageProvider('uploads_test');
      await assert.rejects(
        async () => {
          await localProvider.headObject('../../Windows/System32/cmd.exe');
        },
        (err: any) => {
          assert.match(err.message, /Path traversal detected/);
          return true;
        }
      );
    });
  });

  // 2. File Security & Validation Tests
  describe('2. File Security, Extension Allowlist, Magic Bytes & Sanitization', () => {
    it('2.1 Sanitize filename removes directory paths, null bytes, and non-printable characters', () => {
      const dirty = '../../etc/../passwd\0.pdf';
      const clean = sanitizeFilename(dirty);
      assert.strictEqual(clean, 'passwd.pdf');

      const messy = 'My Project Plan (Final!) #2026.docx';
      const cleanMessy = sanitizeFilename(messy);
      assert.strictEqual(cleanMessy, 'My Project Plan (Final!) #2026.docx');
    });

    it('2.2 Validates magic bytes for genuine PDF (%PDF-)', () => {
      const validPdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj');
      assert.strictEqual(validateMagicBytes(validPdf, 'pdf'), true);

      const fakePdf = Buffer.from('<html><body>Fake PDF with HTML content</body></html>');
      assert.strictEqual(validateMagicBytes(fakePdf, 'pdf'), false);
    });

    it('2.3 Validates magic bytes for genuine PNG (\\x89PNG\\r\\n\\x1a\\n)', () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      assert.strictEqual(validateMagicBytes(validPng, 'png'), true);

      const fakePng = Buffer.from('Not a real PNG header at all');
      assert.strictEqual(validateMagicBytes(fakePng, 'png'), false);
    });

    it('2.4 Validates magic bytes for genuine JPEG (\\xFF\\xD8\\xFF)', () => {
      const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      assert.strictEqual(validateMagicBytes(validJpg, 'jpg'), true);
      assert.strictEqual(validateMagicBytes(validJpg, 'jpeg'), true);

      const fakeJpg = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      assert.strictEqual(validateMagicBytes(fakeJpg, 'jpg'), false);
    });

    it('2.5 Validates magic bytes for ZIP and Office OpenXML (PK\\x03\\x04)', () => {
      const validZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
      assert.strictEqual(validateMagicBytes(validZip, 'zip'), true);
      assert.strictEqual(validateMagicBytes(validZip, 'docx'), true);
      assert.strictEqual(validateMagicBytes(validZip, 'xlsx'), true);
      assert.strictEqual(validateMagicBytes(validZip, 'pptx'), true);
    });

    it('2.6 Rejects dangerous executable extensions (.exe, .bat, .sh, .cmd, .php)', async () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
      await assert.rejects(
        async () => {
          await customFileService.uploadFileDirect(meetingCode, hostUser._id.toString(), {
            buffer: exeBuffer,
            originalname: 'trojan.exe',
            mimetype: 'application/x-msdownload',
            size: exeBuffer.length,
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'DANGEROUS_FILE_TYPE');
          return true;
        }
      );
    });

    it('2.7 Rejects empty files (0 bytes)', async () => {
      await assert.rejects(
        async () => {
          await customFileService.uploadFileDirect(meetingCode, hostUser._id.toString(), {
            buffer: Buffer.alloc(0),
            originalname: 'empty.pdf',
            mimetype: 'application/pdf',
            size: 0,
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'EMPTY_FILE');
          return true;
        }
      );
    });
  });

  // 3. Direct Multipart Upload Flow
  describe('3. Direct Multipart Stream Upload & Real-Time Notification', () => {
    it('3.1 Admitted participant uploads valid PDF; persists in MongoDB and emits file:shared event', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
      let capturedSocketEvent: any = null;

      // Connect client socket to listen for file:shared
      const clientSocket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        auth: { token: guestToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        clientSocket.on('connect', () => {
          clientSocket.emit('meeting:subscribe', { meetingCode }, (res: any) => {
            if (!res?.ok) {
              reject(new Error(`Subscribe failed: ${JSON.stringify(res)}`));
              return;
            }
            resolve();
          });
        });
        clientSocket.on('connect_error', reject);
      });

      clientSocket.on('file:shared', (data) => {
        capturedSocketEvent = data;
      });

      const uploaded = await customFileService.uploadFileDirect(
        meetingCode,
        hostUser._id.toString(),
        {
          buffer: pdfBuffer,
          originalname: 'MeetingAgenda.pdf',
          mimetype: 'application/pdf',
          size: pdfBuffer.length,
        }
      );

      assert.ok(uploaded.id);
      assert.strictEqual(uploaded.originalFilename, 'MeetingAgenda.pdf');
      assert.strictEqual(uploaded.sanitizedFilename, 'MeetingAgenda.pdf');
      assert.strictEqual(uploaded.extension, 'pdf');
      assert.strictEqual(uploaded.mimeType, 'application/pdf');
      assert.strictEqual(uploaded.sizeBytes, pdfBuffer.length);
      assert.strictEqual(uploaded.status, 'AVAILABLE');
      assert.strictEqual(uploaded.uploaderName, 'Priya Host');
      assert.ok(uploaded.checksumSha256);

      // Verify file exists in memory storage
      const head = await memoryStorage.headObject(
        `meetings/${meetingId}/${uploaded.id}/MeetingAgenda.pdf`
      );
      assert.strictEqual(head.exists, true);
      assert.strictEqual(head.sizeBytes, pdfBuffer.length);

      // Verify Socket.IO event received
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(capturedSocketEvent);
      assert.strictEqual(capturedSocketEvent.id, uploaded.id);
      assert.strictEqual(capturedSocketEvent.originalFilename, 'MeetingAgenda.pdf');

      clientSocket.disconnect();
    });
  });

  // 4. Presigned S3 Upload Flow
  describe('4. Presigned Upload Initialization & Completion', () => {
    it('4.1 initPresignedUpload creates PENDING record; completePresignedUpload verifies and marks AVAILABLE', async () => {
      const initRes = await customFileService.initPresignedUpload(
        meetingCode,
        guestUser._id.toString(),
        {
          filename: 'PresentationSlides.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          sizeBytes: 524288,
        }
      );

      assert.ok(initRes.fileId);
      assert.ok(initRes.uploadUrl);
      assert.strictEqual(initRes.file.status, 'PENDING');
      assert.strictEqual(initRes.file.originalFilename, 'PresentationSlides.pptx');

      // Non-uploader cannot complete upload
      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(
            meetingCode,
            hostUser._id.toString(),
            initRes.fileId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'NOT_UPLOADER');
          return true;
        }
      );

      // Simulate client writing genuine PPTX package to storage
      const testBuffer = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<Types/>' },
        { name: 'ppt/presentation.xml', content: '<p:presentation/>' },
      ]);
      await memoryStorage.uploadStream(
        `meetings/${meetingId}/${initRes.fileId}/PresentationSlides.pptx`,
        Readable.from(testBuffer),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        testBuffer.length
      );

      // Guest completes upload
      const completed = await customFileService.completePresignedUpload(
        meetingCode,
        guestUser._id.toString(),
        initRes.fileId
      );

      assert.strictEqual(completed.status, 'AVAILABLE');
      assert.strictEqual(completed.id, initRes.fileId);
    });
  });

  // 5. File Listing & Filtering Tests
  describe('5. Meeting Files Listing & Search Query Filtering', () => {
    it('5.1 listMeetingFiles returns active files and filters by search query', async () => {
      const listAll = await customFileService.listMeetingFiles(
        meetingCode,
        guestUser._id.toString(),
        { limit: 20 }
      );
      assert.ok(listAll.files.length >= 2);

      const searchAgenda = await customFileService.listMeetingFiles(
        meetingCode,
        guestUser._id.toString(),
        { search: 'agenda' }
      );
      assert.strictEqual(searchAgenda.files.length, 1);
      assert.strictEqual(searchAgenda.files[0].originalFilename, 'MeetingAgenda.pdf');
    });
  });

  // 6. Secure Download Streaming
  describe('6. Secure Download Streaming & Headers', () => {
    it('6.1 getFileForDownload returns valid stream with sanitized filename and metadata', async () => {
      const list = await customFileService.listMeetingFiles(
        meetingCode,
        hostUser._id.toString(),
        { search: 'MeetingAgenda' }
      );
      const targetFile = list.files[0];
      assert.ok(targetFile);

      const downloadResult = await customFileService.getFileForDownload(
        meetingCode,
        hostUser._id.toString(),
        targetFile.id
      );

      assert.strictEqual(downloadResult.filename, 'MeetingAgenda.pdf');
      assert.strictEqual(downloadResult.contentType, 'application/pdf');
      assert.ok(downloadResult.stream);

      const chunks: Buffer[] = [];
      for await (const chunk of downloadResult.stream) {
        chunks.push(Buffer.from(chunk));
      }
      const streamContent = Buffer.concat(chunks).toString('utf-8');
      assert.ok(streamContent.startsWith('%PDF-1.4'));
    });
  });

  // 7. Deletion Permissions & Cascading Deletion
  describe('7. File Deletion Permissions & Room Notifications', () => {
    it('7.1 Non-elevated participant cannot delete another participant file', async () => {
      const list = await customFileService.listMeetingFiles(
        meetingCode,
        hostUser._id.toString(),
        { search: 'MeetingAgenda' }
      );
      const hostFile = list.files[0];

      // Guest tries to delete host's file
      await assert.rejects(
        async () => {
          await customFileService.deleteFile(
            meetingCode,
            guestUser._id.toString(),
            hostFile.id
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'DELETE_NOT_AUTHORIZED');
          return true;
        }
      );
    });

    it('7.2 Uploader can delete their own file; emits file:deleted and deletes from storage', async () => {
      const list = await customFileService.listMeetingFiles(
        meetingCode,
        guestUser._id.toString(),
        { search: 'PresentationSlides' }
      );
      const guestFile = list.files[0];
      assert.ok(guestFile);

      let capturedDeleteEvent: any = null;
      const clientSocket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        auth: { token: hostToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        clientSocket.on('connect', () => {
          clientSocket.emit('meeting:subscribe', { meetingCode }, (res: any) => {
            if (!res?.ok) {
              reject(new Error(`Subscribe failed: ${JSON.stringify(res)}`));
              return;
            }
            resolve();
          });
        });
        clientSocket.on('connect_error', reject);
      });

      clientSocket.on('file:deleted', (data) => {
        capturedDeleteEvent = data;
      });

      const delResult = await customFileService.deleteFile(
        meetingCode,
        guestUser._id.toString(),
        guestFile.id
      );

      assert.strictEqual(delResult.success, true);
      assert.strictEqual(delResult.fileId, guestFile.id);

      // Verify file marked deleted in MongoDB
      const fileDoc = await SharedFile.findById(guestFile.id);
      assert.ok(fileDoc);
      assert.strictEqual(fileDoc.isDeleted, true);
      assert.strictEqual(fileDoc.status, 'DELETED');

      // Verify physical storage deleted
      const head = await memoryStorage.headObject(fileDoc.storageKey);
      assert.strictEqual(head, null);

      // Verify socket event emitted
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(capturedDeleteEvent);
      assert.strictEqual(capturedDeleteEvent.fileId, guestFile.id);

      clientSocket.disconnect();
    });

    it('7.3 Room Host can delete any participant file', async () => {
      // First, guest uploads a file
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const guestUpload = await customFileService.uploadFileDirect(
        meetingCode,
        guestUser._id.toString(),
        {
          buffer: pngBuffer,
          originalname: 'diagram.png',
          mimetype: 'image/png',
          size: pngBuffer.length,
        }
      );

      // Host deletes guest's file
      const delResult = await customFileService.deleteFile(
        meetingCode,
        hostUser._id.toString(),
        guestUpload.id
      );
      assert.strictEqual(delResult.success, true);
    });
  });

  // 8. Access Control & Authorization Boundaries
  describe('8. Access Control, Waiting-Room, and Expired Meeting Rejection', () => {
    it('8.1 Waiting-room user (not admitted) is rejected with 403 FILE_ACCESS_DENIED', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj');
      await assert.rejects(
        async () => {
          await customFileService.uploadFileDirect(
            meetingCode,
            waitingUser._id.toString(),
            {
              buffer: pdfBuffer,
              originalname: 'waiting.pdf',
              mimetype: 'application/pdf',
              size: pdfBuffer.length,
            }
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_ACCESS_DENIED');
          return true;
        }
      );
    });

    it('8.2 Outsider (not in meeting) is rejected with 403 FILE_ACCESS_DENIED', async () => {
      await assert.rejects(
        async () => {
          await customFileService.listMeetingFiles(
            meetingCode,
            outsiderUser._id.toString(),
            {}
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_ACCESS_DENIED');
          return true;
        }
      );
    });
  });

  // 9. Dashboard Integration Contract
  describe('9. Dashboard Integration (getUserSharedFiles)', () => {
    it('9.1 Maps to ISharedFileItem contract with associatedMeetingName and code', async () => {
      const userFiles = await customFileService.getUserSharedFiles(hostUser._id.toString());
      assert.ok(userFiles.length >= 1);

      const firstFile = userFiles[0];
      assert.ok(firstFile.id);
      assert.ok(firstFile.name);
      assert.ok(firstFile.extension);
      assert.ok(firstFile.sizeBytes);
      assert.ok(firstFile.sharedAt);
      assert.strictEqual(firstFile.associatedMeetingName, 'Phase 13 File Sharing Architecture Session');
      assert.strictEqual(firstFile.associatedMeetingCode, meetingCode);
      assert.ok(firstFile.sharedBy.id);
      assert.ok(firstFile.sharedBy.name);
      assert.ok(firstFile.mimeType);
    });
  });

  // 10. LiveKit Invariant Check
  describe('10. LiveKit Token Invariant (canPublishData: false)', () => {
    it('10.1 LiveKit participant tokens strictly maintain canPublishData: false', async () => {
      const tokenResult = await livekitService.generateParticipantToken({
        meetingId,
        userId: guestUser._id.toString(),
        displayName: 'Rohan Guest',
        role: 'participant',
        maxParticipants: 10,
        provisionRoom: false,
      });

      assert.ok(tokenResult.token);
      assert.strictEqual(tokenResult.ttlSeconds, 600);
      assert.strictEqual(tokenResult.permissions.canPublishData, false);

      // Parse payload of LiveKit JWT
      const parts = tokenResult.token.split('.');
      assert.strictEqual(parts.length, 3);
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));

      assert.ok(payload.video);
      assert.strictEqual(payload.video.canPublishData, false);
      assert.strictEqual(payload.video.room, `cly_room_${meetingId.toLowerCase()}`);
    });
  });

  // 11. Hardened Security & Reliability Checks (DEF-13-01 to DEF-13-06)
  describe('11. Hardened Security & Reliability Checks (DEF-13-01 to DEF-13-06)', () => {
    it('11.1 DEF-13-06: inspectZipArchive detects and rejects ZIP bomb (>20:1 ratio)', () => {
      const bombZip = createMockZipBuffer([
        { name: 'bomb.txt', content: 'x', compressedSize: 10, uncompressedSize: 5000000 },
      ]);
      assert.throws(
        () => inspectZipArchive(bombZip),
        (err: any) => {
          assert.strictEqual(err.code, 'ARCHIVE_BOMB_DETECTED');
          return true;
        }
      );
    });

    it('11.2 DEF-13-06: inspectZipArchive detects and rejects path traversal in archive', () => {
      const traversalZip = createMockZipBuffer([
        { name: '../../etc/shadow', content: 'fake' },
      ]);
      assert.throws(
        () => inspectZipArchive(traversalZip),
        (err: any) => {
          assert.strictEqual(err.code, 'PATH_TRAVERSAL_IN_ARCHIVE');
          return true;
        }
      );
    });

    it('11.3 DEF-13-06: validateZipPayloadSecurity rejects executable inside ZIP (.exe / .bat)', () => {
      const badZip = createMockZipBuffer([
        { name: 'document.txt', content: 'safe' },
        { name: 'installer.exe', content: 'malicious' },
      ]);
      assert.throws(
        () => validateZipPayloadSecurity(badZip),
        (err: any) => {
          assert.strictEqual(err.code, 'DANGEROUS_FILE_IN_ARCHIVE');
          return true;
        }
      );
    });

    it('11.4 DEF-13-06: validateOpenXmlPackage rejects docx missing word/ part', () => {
      const fakeDocx = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<Types/>' },
        { name: 'other/file.txt', content: 'hello' },
      ]);
      assert.throws(
        () => validateOpenXmlPackage(fakeDocx, 'docx'),
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_DOCUMENT_STRUCTURE');
          return true;
        }
      );
    });

    it('11.5 DEF-13-06: validateOpenXmlPackage accepts genuine docx structure', () => {
      const validDocx = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<Types/>' },
        { name: 'word/document.xml', content: '<w:document/>' },
      ]);
      assert.doesNotThrow(() => validateOpenXmlPackage(validDocx, 'docx'));
    });

    it('11.6 DEF-13-01: completePresignedUpload rejects empty (0 bytes) storage object', async () => {
      const init = await customFileService.initPresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        {
          filename: 'empty.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }
      );

      // Storage has empty file (0 bytes)
      const fileDoc = await SharedFile.findById(init.fileId);
      assert.ok(fileDoc);
      await memoryStorage.uploadStream(fileDoc.storageKey, Readable.from(Buffer.alloc(0)), 'application/pdf', 0);

      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(
            meetingCode,
            hostUser._id.toString(),
            init.fileId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_EMPTY');
          return true;
        }
      );
    });

    it('11.7 DEF-13-01: completePresignedUpload rejects oversized storage object (>25MB)', async () => {
      const init = await customFileService.initPresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        {
          filename: 'oversized.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        }
      );

      // Mock oversized storage object by writing a large dummy buffer or overriding head
      const fileDoc = await SharedFile.findById(init.fileId);
      assert.ok(fileDoc);

      // Upload larger than 25MB (26MB)
      const largeBuf = Buffer.alloc(27262976);
      largeBuf.write('%PDF-1.4', 0, 'utf8');
      await memoryStorage.uploadStream(fileDoc.storageKey, Readable.from(largeBuf), 'application/pdf', largeBuf.length);

      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(
            meetingCode,
            hostUser._id.toString(),
            init.fileId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_TOO_LARGE');
          return true;
        }
      );
    });

    it('11.8 DEF-13-01: completePresignedUpload rejects magic byte mismatch on storage object', async () => {
      const init = await customFileService.initPresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        {
          filename: 'deceptive.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 500,
        }
      );

      const fileDoc = await SharedFile.findById(init.fileId);
      assert.ok(fileDoc);

      // Stored content is plain ASCII, not %PDF
      const deceptiveBuf = Buffer.from('NOT A PDF FILE AT ALL');
      await memoryStorage.uploadStream(fileDoc.storageKey, Readable.from(deceptiveBuf), 'application/pdf', deceptiveBuf.length);

      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(
            meetingCode,
            hostUser._id.toString(),
            init.fileId
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'MAGIC_BYTE_MISMATCH');
          return true;
        }
      );
    });

    it('11.9 DEF-13-02: Concurrent completePresignedUpload calls emit exactly one file:shared event', async () => {
      const init = await customFileService.initPresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        {
          filename: 'concurrent_doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        }
      );

      const fileDoc = await SharedFile.findById(init.fileId);
      assert.ok(fileDoc);

      const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj');
      await memoryStorage.uploadStream(fileDoc.storageKey, Readable.from(validPdf), 'application/pdf', validPdf.length);

      let emitCount = 0;
      const clientSocket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        auth: { token: guestToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        clientSocket.on('connect', () => {
          clientSocket.emit('meeting:subscribe', { meetingCode }, (res: any) => {
            if (!res?.ok) return reject(new Error('Subscribe failed'));
            resolve();
          });
        });
        clientSocket.on('connect_error', reject);
      });

      clientSocket.on('file:shared', (data) => {
        if (data.id === init.fileId) {
          emitCount += 1;
        }
      });

      // Fire 3 simultaneous completion requests
      const [r1, r2, r3] = await Promise.all([
        customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), init.fileId),
        customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), init.fileId),
        customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), init.fileId),
      ]);

      assert.strictEqual(r1.id, init.fileId);
      assert.strictEqual(r2.id, init.fileId);
      assert.strictEqual(r3.id, init.fileId);

      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(emitCount, 1, 'Only one file:shared event must be emitted across concurrent calls');

      clientSocket.disconnect();
    });

    it('11.10 DEF-13-04: cleanupExpiredAndOrphanedFiles purges expired pending records and retries failed deletions', async () => {
      // 1. Create an expired pending record
      const expiredPending = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'expired_pending.pdf',
        sanitizedFilename: 'expired_pending.pdf',
        storageKey: `meetings/${meetingId}/expired/pending.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 500,
        status: 'PENDING',
        pendingExpiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago
        cleanupStatus: 'NONE',
        cleanupRetries: 0,
        isDeleted: false,
      });

      // 2. Create a record with STORAGE_DELETE_FAILED
      const failedDel = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'retry_del.pdf',
        sanitizedFilename: 'retry_del.pdf',
        storageKey: `meetings/${meetingId}/retry/del.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 500,
        status: 'DELETED',
        cleanupStatus: 'STORAGE_DELETE_FAILED',
        cleanupRetries: 1,
        isDeleted: true,
      });

      const report = await customFileService.cleanupExpiredAndOrphanedFiles();
      assert.ok(report.expiredPendingCleaned >= 1);
      assert.ok(report.failedDeletionsRetried >= 1);

      // Verify expired pending transitioned to FAILED and CLEANED
      const cleanedPending = await SharedFile.findById(expiredPending._id);
      assert.strictEqual(cleanedPending?.status, 'FAILED');
      assert.strictEqual(cleanedPending?.cleanupStatus, 'CLEANED');

      // Verify retry deletion transitioned to CLEANED
      const cleanedDel = await SharedFile.findById(failedDel._id);
      assert.strictEqual(cleanedDel?.cleanupStatus, 'CLEANED');
    });

    it('11.11 DEF-13-05: getFileForDownload returns direct stream without presignedUrl redirect', async () => {
      // Upload a file to test download streaming
      const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj');
      const upload = await customFileService.uploadFileDirect(
        meetingCode,
        hostUser._id.toString(),
        {
          buffer: validPdf,
          originalname: 'stream_test.pdf',
          mimetype: 'application/pdf',
          size: validPdf.length,
        }
      );

      const downloadResult = await customFileService.getFileForDownload(
        meetingCode,
        guestUser._id.toString(),
        upload.id
      );

      assert.strictEqual(downloadResult.presignedUrl, undefined, 'Downloads must not return presignedUrl redirect');
      assert.ok(downloadResult.stream, 'Downloads must return readable stream');
      assert.strictEqual(downloadResult.filename, 'stream_test.pdf');
      assert.strictEqual(downloadResult.contentType, 'application/pdf');
    });
  });

  describe('12. DEF-13-08: S3 Upload Boundary Enforcement & Presigned POST Policy', () => {
    it('12.1 DEF-13-08: S3StorageProvider creates presigned POST with exact content-length-range [1, 26214400]', async () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      const presigned = await s3Provider.generatePresignedUploadUrl(
        'meetings/m1/f1/document.pdf',
        'application/pdf',
        1024,
        900
      );

      assert.strictEqual(presigned.method, 'POST', 'S3 provider must generate presigned POST method');
      assert.ok(presigned.fields, 'S3 presigned POST must provide fields');
      assert.strictEqual(presigned.fields['key'], 'meetings/m1/f1/document.pdf');

      const policyStr = presigned.fields['policy'] || presigned.fields['Policy'];
      assert.ok(policyStr, `S3 presigned POST must include Base64-encoded policy. Fields: ${JSON.stringify(Object.keys(presigned.fields))}`);

      // Decode and verify AWS S3 policy conditions
      const policyJson = JSON.parse(Buffer.from(policyStr, 'base64').toString('utf8'));
      assert.ok(Array.isArray(policyJson.conditions), 'Policy must contain conditions array');

      // Assert content-length-range is strictly bounded to [1, 26214400]
      const rangeCondition = policyJson.conditions.find(
        (c: any) => Array.isArray(c) && c[0] === 'content-length-range'
      );
      assert.ok(rangeCondition, 'Policy must specify content-length-range condition');
      assert.strictEqual(rangeCondition[1], 1, 'Minimum content-length must be 1 byte');
      assert.strictEqual(rangeCondition[2], 26214400, 'Maximum content-length must be exactly 26214400 bytes (25 MB)');

      // Assert Content-Type condition
      const typeCondition = policyJson.conditions.find(
        (c: any) => Array.isArray(c) && c[0] === 'eq' && (c[1] === '$Content-Type' || c[1] === '$content-type')
      );
      assert.ok(typeCondition, 'Policy must enforce exact $Content-Type condition');
      assert.strictEqual(typeCondition[2], 'application/pdf');
    });

    it('12.2 DEF-13-08: Presigned upload initialization enforces rate limit (max 15 uploads/minute)', async () => {
      const uniqueSuffix = Date.now().toString();
      const testUser = await User.create({
        email: `ratelimit_${uniqueSuffix}@example.com`,
        passwordHash: 'dummy',
        firstName: 'Rate',
        lastName: 'Limit',
        isEmailVerified: true,
      });

      await MeetingParticipant.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        userId: testUser._id,
        email: testUser.email,
        role: 'participant',
        admissionStatus: 'ADMITTED',
        displayName: 'Rate Limitee',
        joinedAt: new Date(),
      });

      // Execute 15 valid upload inits (should all succeed)
      for (let i = 0; i < 15; i++) {
        const init = await customFileService.initPresignedUpload(meetingCode, testUser._id.toString(), {
          filename: `doc_${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });
        assert.ok(init.fileId);
      }

      // The 16th upload must be rejected with 429 RATE_LIMIT_EXCEEDED
      await assert.rejects(
        async () => {
          await customFileService.initPresignedUpload(meetingCode, testUser._id.toString(), {
            filename: 'doc_16.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 429);
          assert.strictEqual(err.code, 'RATE_LIMIT_EXCEEDED');
          return true;
        }
      );
    });

    it('12.3 DEF-13-08: Exactly 25 MB boundary enforcement: accepts 26,214,400 bytes and rejects 26,214,401 bytes', async () => {
      // 26,214,400 bytes (exactly 25 MB) must succeed initialization
      const validBoundary = await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
        filename: 'exact_25mb.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 26214400,
      });
      assert.ok(validBoundary.fileId);

      // 26,214,401 bytes (25 MB + 1 byte) must be rejected
      await assert.rejects(
        async () => {
          await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
            filename: 'oversized_25mb.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 26214401,
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_TOO_LARGE');
          return true;
        }
      );
    });

    it('12.4 DEF-13-08: Empty files (0 bytes) rejected during presigned upload initialization', async () => {
      await assert.rejects(
        async () => {
          await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
            filename: 'empty.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 0,
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'EMPTY_FILE');
          return true;
        }
      );
    });
  });

  describe('13. DEF-13-09: Complete Archive & OpenXML Central Directory Traversal', () => {
    it('13.1 DEF-13-09: validateStorageArchive validates legitimate OpenXML docx with EOCD near end of archive', async () => {
      const docxBuffer = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
        { name: 'word/document.xml', content: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:document>' },
      ]);

      const storageKey = `meetings/${meetingId}/valid_docx.docx`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(docxBuffer),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxBuffer.length
      );

      // Must succeed without error
      await validateStorageArchive(memoryStorage, storageKey, docxBuffer.length, 'docx');
    });

    it('13.2 DEF-13-09: validateStorageArchive traverses Central Directory and rejects dangerous files located after 64KB', async () => {
      // Create a 70 KB initial benign entry to push the dangerous entry well past 64 KB
      const padding = 'X'.repeat(70 * 1024);
      const zipBuffer = createMockZipBuffer([
        { name: 'document.txt', content: padding },
        { name: 'payload.exe', content: 'MZ_DUMMY_EXECUTABLE_BINARY' },
      ]);

      assert.ok(zipBuffer.length > 70 * 1024, 'Archive must be larger than 64 KB');

      const storageKey = `meetings/${meetingId}/archive_with_exe.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.ok(
            err.code === 'DANGEROUS_FILE_IN_ARCHIVE' || err.code === 'DANGEROUS_ARCHIVE_ENTRY',
            `Expected DANGEROUS_FILE_IN_ARCHIVE or DANGEROUS_ARCHIVE_ENTRY, got ${err.code}`
          );
          assert.ok(err.message.includes('payload.exe'));
          return true;
        }
      );
    });

    it('13.3 DEF-13-09: validateStorageArchive rejects archives containing duplicate filenames', async () => {
      const zipBuffer = createMockZipBuffer([
        { name: 'notes.txt', content: 'First version' },
        { name: 'notes.txt', content: 'Shadow version' },
      ]);

      const storageKey = `meetings/${meetingId}/duplicate_entries.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'DUPLICATE_ARCHIVE_ENTRY');
          return true;
        }
      );
    });

    it('13.4 DEF-13-09: validateStorageArchive rejects ZIP64 archives with ZIP64_NOT_SUPPORTED', async () => {
      // Override totalEntries to 0xFFFF (ZIP64 sentinel)
      const zipBuffer = createMockZipBuffer(
        [{ name: 'data.txt', content: 'some data' }],
        { overrideEocdTotalEntries: 0xFFFF }
      );

      const storageKey = `meetings/${meetingId}/zip64.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZIP64_NOT_SUPPORTED');
          return true;
        }
      );
    });

    it('13.5 DEF-13-09: validateStorageArchive rejects archives with corrupted Central Directory offsets', async () => {
      // Corrupt the CD offset to point past EOF
      const zipBuffer = createMockZipBuffer(
        [{ name: 'data.txt', content: 'some data' }],
        { overrideEocdCdOffset: 9999999 }
      );

      const storageKey = `meetings/${meetingId}/corrupt_offset.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.ok(
            err.code === 'INVALID_ARCHIVE_OFFSET' || err.code === 'MALFORMED_CENTRAL_DIRECTORY',
            `Expected INVALID_ARCHIVE_OFFSET or MALFORMED_CENTRAL_DIRECTORY, got ${err.code}`
          );
          return true;
        }
      );
    });

    it('13.6 DEF-13-09: Validates large genuine XLSX package with Central Directory and EOCD near end', async () => {
      // 100 KB sheet content pushing EOCD well past 64KB
      const sheetData = '<worksheet>' + 'A'.repeat(100 * 1024) + '</worksheet>';
      const xlsxBuffer = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
        { name: 'xl/workbook.xml', content: '<?xml version="1.0"?><workbook></workbook>' },
        { name: 'xl/worksheets/sheet1.xml', content: sheetData },
      ]);

      const storageKey = `meetings/${meetingId}/large_data.xlsx`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(xlsxBuffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xlsxBuffer.length
      );

      // Must succeed without error
      await validateStorageArchive(memoryStorage, storageKey, xlsxBuffer.length, 'xlsx');
    });

    it('13.7 DEF-13-09: Validates large genuine PPTX package with Central Directory and EOCD near end', async () => {
      // 100 KB slide content pushing EOCD well past 64KB
      const slideData = '<p:sld>' + 'P'.repeat(100 * 1024) + '</p:sld>';
      const pptxBuffer = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
        { name: 'ppt/presentation.xml', content: '<?xml version="1.0"?><p:presentation></p:presentation>' },
        { name: 'ppt/slides/slide1.xml', content: slideData },
      ]);

      const storageKey = `meetings/${meetingId}/large_deck.pptx`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(pptxBuffer),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        pptxBuffer.length
      );

      // Must succeed without error
      await validateStorageArchive(memoryStorage, storageKey, pptxBuffer.length, 'pptx');
    });

    it('13.8 DEF-13-09: Rejects non-OpenXML zip file disguised with .docx extension (INVALID_DOCUMENT_STRUCTURE)', async () => {
      // Non-OpenXML zip containing arbitrary text files
      const disguisedZip = createMockZipBuffer([
        { name: 'readme.txt', content: 'hello world' },
        { name: 'data.json', content: '{}' },
      ]);

      const storageKey = `meetings/${meetingId}/fake_word.docx`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(disguisedZip),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        disguisedZip.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, disguisedZip.length, 'docx');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_DOCUMENT_STRUCTURE');
          return true;
        }
      );
    });

    it('13.9 DEF-13-09: Rejects archive containing path traversal entries (PATH_TRAVERSAL_IN_ARCHIVE)', async () => {
      const traversalZip = createMockZipBuffer([
        { name: '../../etc/shadow', content: 'root:x:0:0:root:/root:/bin/bash' },
      ]);

      const storageKey = `meetings/${meetingId}/traversal.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(traversalZip),
        'application/zip',
        traversalZip.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, traversalZip.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'PATH_TRAVERSAL_IN_ARCHIVE');
          return true;
        }
      );
    });

    it('13.10 DEF-13-09: Rejects ZIP bomb with dangerous compression ratio (>20:1)', async () => {
      // Small compressed payload claiming gigantic uncompressed size
      const bombZip = createMockZipBuffer([
        {
          name: 'huge_zeros.bin',
          content: '0000000000',
          compressedSize: 10,
          uncompressedSize: 10 * 1024 * 1024, // 10 MB uncompressed from 10 bytes -> 1,000,000:1 ratio
        },
      ]);

      const storageKey = `meetings/${meetingId}/bomb.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(bombZip),
        'application/zip',
        bombZip.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, bombZip.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ARCHIVE_BOMB_DETECTED');
          return true;
        }
      );
    });

    it('13.11 DEF-13-09: Validates large genuine DOCX package (>64 KB) with Central Directory and EOCD near end', async () => {
      const docData = '<w:document>' + 'W'.repeat(70 * 1024) + '</w:document>';
      const docxBuffer = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
        { name: 'word/document.xml', content: docData },
      ]);

      assert.ok(docxBuffer.length > 64 * 1024, 'Large DOCX buffer must exceed 64 KB');
      const storageKey = `meetings/${meetingId}/large_valid.docx`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(docxBuffer),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxBuffer.length
      );

      await validateStorageArchive(memoryStorage, storageKey, docxBuffer.length, 'docx');
    });

    it('13.12 DEF-13-09: Rejects archive with entry count exceeding 1000 limit (ARCHIVE_TOO_MANY_ENTRIES)', async () => {
      const zipBuffer = createMockZipBuffer(
        [{ name: 'file1.txt', content: 'data' }],
        { overrideEocdTotalEntries: 1005 }
      );

      const storageKey = `meetings/${meetingId}/too_many_entries.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ARCHIVE_TOO_MANY_ENTRIES');
          return true;
        }
      );
    });

    it('13.13 DEF-13-09: Rejects archive with overlapping local headers and payloads (MALFORMED_LOCAL_HEADER)', async () => {
      // Entry 0 offset is 0, payload 100 bytes. Override entry 1 offset to 50 (overlapping entry 0)
      const zipBuffer = createMockZipBuffer(
        [
          { name: 'entry0.txt', content: 'X'.repeat(100) },
          { name: 'entry1.txt', content: 'Y'.repeat(100) },
        ],
        { overrideCdOffsetForIndex: { index: 1, offset: 50 } }
      );

      const storageKey = `meetings/${meetingId}/overlapping_headers.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'MALFORMED_LOCAL_HEADER');
          return true;
        }
      );
    });

    it('13.14 DEF-13-09: Rejects archive with corrupted/invalid local header at entry 15', async () => {
      // 16 entries where entry 15 (index 15) has a corrupted local header signature
      const entriesList = Array.from({ length: 16 }, (_, i) => ({
        name: `part_${i}.txt`,
        content: `file content ${i}`,
      }));

      const zipBuffer = createMockZipBuffer(entriesList, { corruptLocalHeaderAt: 15 });

      const storageKey = `meetings/${meetingId}/corrupt_entry_15.zip`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(zipBuffer),
        'application/zip',
        zipBuffer.length
      );

      await assert.rejects(
        async () => {
          await validateStorageArchive(memoryStorage, storageKey, zipBuffer.length, 'zip');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ARCHIVE_HEADER_MISMATCH');
          return true;
        }
      );
    });
  });

  describe('14. DEF-13-10: Server-Side Authoritative Checksum & Immutable VersionId Binding', () => {
    it('14.1 DEF-13-10: completePresignedUpload computes authoritative SHA-256 and rejects client checksum mismatch', async () => {
      const init = await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
        filename: 'checksum_test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      const fileDoc = await SharedFile.findById(init.fileId);
      assert.ok(fileDoc, 'File record must exist in MongoDB');

      const pdfData = Buffer.from('%PDF-1.4\n' + 'B'.repeat(80) + '\n%%EOF');
      await memoryStorage.uploadStream(
        fileDoc.storageKey,
        Readable.from(pdfData),
        'application/pdf',
        pdfData.length
      );

      // Attempt completion with forged/tampered checksum
      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), init.fileId, {
            checksumSha256: '0000000000000000000000000000000000000000000000000000000000000000',
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
          return true;
        }
      );

      // Verify file record was set to FAILED and CLEANED
      const fileRecord = await SharedFile.findById(init.fileId);
      assert.strictEqual(fileRecord?.status, 'FAILED');
      assert.strictEqual(fileRecord?.cleanupStatus, 'CLEANED');
    });

    it('14.2 DEF-13-10: completePresignedUpload computes authoritative SHA-256 and records VersionId in MongoDB', async () => {
      const init = await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
        filename: 'authoritative_test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 120,
      });

      const fileDoc = await SharedFile.findById(init.fileId);
      assert.ok(fileDoc, 'File record must exist in MongoDB');

      const pdfData = Buffer.from('%PDF-1.4\n' + 'C'.repeat(100) + '\n%%EOF');
      const expectedSha256 = crypto.createHash('sha256').update(pdfData).digest('hex');

      await memoryStorage.uploadStream(
        fileDoc.storageKey,
        Readable.from(pdfData),
        'application/pdf',
        pdfData.length
      );

      // Complete without client checksum; backend computes authoritative hash
      const completed = await customFileService.completePresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        init.fileId
      );

      assert.strictEqual(completed.status, 'AVAILABLE');
      assert.strictEqual(completed.checksumSha256, expectedSha256);

      const dbRecord = await SharedFile.findById(init.fileId);
      assert.strictEqual(dbRecord?.checksumSha256, expectedSha256);
      assert.ok(dbRecord?.versionId, 'MongoDB record must store validated storage versionId');
    });

    it('14.3 DEF-13-10: getFileForDownload streams validated versionId, preventing post-validation overwrite attacks', async () => {
      // 1. Upload Version 1
      const v1Data = Buffer.from('%PDF-1.4\nOriginal Version 1 Content\n%%EOF');
      const upload = await customFileService.uploadFileDirect(meetingCode, hostUser._id.toString(), {
        buffer: v1Data,
        originalname: 'immutable_doc.pdf',
        mimetype: 'application/pdf',
        size: v1Data.length,
      });

      const fileRecord = await SharedFile.findById(upload.id);
      const originalVersionId = fileRecord?.versionId;
      assert.ok(originalVersionId, 'Upload must have a recorded versionId');

      // 2. Simulate attacker overwriting the storage key with Version 2
      const v2Data = Buffer.from('%PDF-1.4\nTampered Version 2 Content\n%%EOF');
      await memoryStorage.uploadStream(
        fileRecord!.storageKey,
        Readable.from(v2Data),
        'application/pdf',
        v2Data.length
      );

      // Verify memory storage now has 2 versions
      const headLatest = await memoryStorage.headObject(fileRecord!.storageKey);
      assert.notStrictEqual(headLatest?.versionId, originalVersionId);

      // 3. Download via getFileForDownload — must retrieve Version 1 via originalVersionId
      const download = await customFileService.getFileForDownload(meetingCode, guestUser._id.toString(), upload.id);
      const chunks: Buffer[] = [];
      for await (const chunk of download.stream) {
        chunks.push(chunk as Buffer);
      }
      const downloadedContent = Buffer.concat(chunks).toString('utf8');

      assert.ok(downloadedContent.includes('Original Version 1 Content'), 'Downloaded stream must match validated Version 1');
      assert.ok(!downloadedContent.includes('Tampered Version 2 Content'), 'Downloaded stream must not be overwritten');
    });

    it('14.4 DEF-13-10: Overwrite attempt after successful validation; repeated completion returns existing AVAILABLE DTO without duplicate event', async () => {
      // 1. Init and upload v1
      const init = await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
        filename: 'double_completion.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 150,
      });

      const fileDoc = await SharedFile.findById(init.fileId);
      const v1Data = Buffer.from('%PDF-1.4\nInitial Legit Upload\n%%EOF');
      await memoryStorage.uploadStream(
        fileDoc!.storageKey,
        Readable.from(v1Data),
        'application/pdf',
        v1Data.length
      );

      // 2. First completion succeeds and sets status to AVAILABLE
      const firstComplete = await customFileService.completePresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        init.fileId
      );
      assert.strictEqual(firstComplete.status, 'AVAILABLE');
      const verifiedVersionId = firstComplete.versionId;

      // 3. Attacker uses still-valid presigned URL to overwrite key with v2
      const v2Data = Buffer.from('%PDF-1.4\nMalicious Overwrite Payload\n%%EOF');
      await memoryStorage.uploadStream(
        fileDoc!.storageKey,
        Readable.from(v2Data),
        'application/pdf',
        v2Data.length
      );

      // 4. Repeated completion call returns existing AVAILABLE DTO with original versionId
      const secondComplete = await customFileService.completePresignedUpload(
        meetingCode,
        hostUser._id.toString(),
        init.fileId
      );
      assert.strictEqual(secondComplete.status, 'AVAILABLE');
      assert.strictEqual(secondComplete.versionId, verifiedVersionId);

      // 5. Download retrieves exact original v1 bytes
      const download = await customFileService.getFileForDownload(
        meetingCode,
        guestUser._id.toString(),
        init.fileId
      );
      const chunks: Buffer[] = [];
      for await (const chunk of download.stream) {
        chunks.push(chunk as Buffer);
      }
      const downloaded = Buffer.concat(chunks).toString('utf8');
      assert.ok(downloaded.includes('Initial Legit Upload'));
      assert.ok(!downloaded.includes('Malicious Overwrite Payload'));
    });

    it('14.5 DEF-13-13: readByteRange strictly pins requested versionId and does not return newer version bytes', async () => {
      const storageKey = `meetings/${meetingId}/version_pinned_range.bin`;
      const v1Data = Buffer.from('VERSION_ONE_EXCLUSIVE_CONTENT_12345');
      const v2Data = Buffer.from('VERSION_TWO_TAMPERED_CONTENT_98765');

      const up1 = await memoryStorage.uploadStream(storageKey, Readable.from(v1Data), 'text/plain', v1Data.length);
      const v1Id = up1.versionId!;
      assert.ok(v1Id);

      // Overwrite with Version 2
      const up2 = await memoryStorage.uploadStream(storageKey, Readable.from(v2Data), 'text/plain', v2Data.length);
      const v2Id = up2.versionId!;
      assert.notStrictEqual(v1Id, v2Id);

      // Read range specifying v1Id
      const v1Range = await memoryStorage.readByteRange(storageKey, 0, 10, v1Id);
      assert.strictEqual(v1Range.toString('utf8'), 'VERSION_ONE');

      // Read range specifying v2Id
      const v2Range = await memoryStorage.readByteRange(storageKey, 0, 10, v2Id);
      assert.strictEqual(v2Range.toString('utf8'), 'VERSION_TWO');

      // Requesting non-existent versionId throws 404
      await assert.rejects(
        async () => {
          await memoryStorage.readByteRange(storageKey, 0, 10, 'non_existent_version_xyz');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'STORAGE_VERSION_NOT_FOUND');
          return true;
        }
      );
    });

    it('14.6 DEF-13-13: Concurrent upload of newer version does not affect validateStorageArchive pinned to v1', async () => {
      const docxV1 = createMockZipBuffer([
        { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>' },
        { name: 'word/document.xml', content: '<w:document>Valid V1 Content</w:document>' },
      ]);

      const storageKey = `meetings/${meetingId}/concurrent_version_docx.docx`;
      const up1 = await memoryStorage.uploadStream(
        storageKey,
        Readable.from(docxV1),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxV1.length
      );
      const v1Id = up1.versionId!;

      // Now overwrite key with corrupt/tampered non-docx payload as Version 2
      const corruptV2 = Buffer.from('CORRUPTED_NON_ARCHIVE_DATA_V2');
      await memoryStorage.uploadStream(storageKey, Readable.from(corruptV2), 'application/octet-stream', corruptV2.length);

      // Validation pinned to v1Id must succeed
      await validateStorageArchive(memoryStorage, storageKey, docxV1.length, 'docx', v1Id);
    });
  });

  describe('15. DEF-13-11: Production Cleanup Worker, Distributed Claims & Lease Recovery', () => {
    it('15.1 DEF-13-11: FileCleanupWorker starts and stops cleanly with valid status', async () => {
      const worker = new FileCleanupWorker(memoryStorage);
      assert.strictEqual(worker.getStatus().isRunning, false);

      await worker.start();
      assert.strictEqual(worker.getStatus().isRunning, true);

      await worker.stop();
      assert.strictEqual(worker.getStatus().isRunning, false);
    });

    it('15.2 DEF-13-11: Distributed atomic claims ensure exactly one worker processes an expired record', async () => {
      const expiredPending = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'race_pending.pdf',
        sanitizedFilename: 'race_pending.pdf',
        storageKey: `meetings/${meetingId}/race/pending.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 250,
        status: 'PENDING',
        pendingExpiresAt: new Date(Date.now() - 120000), // Expired 2 minutes ago
        cleanupStatus: 'NONE',
        cleanupRetries: 0,
        isDeleted: false,
      });

      const worker1 = new FileCleanupWorker(memoryStorage);
      const worker2 = new FileCleanupWorker(memoryStorage);

      // Run cleanup simultaneously
      const [report1, report2] = await Promise.all([
        worker1.runCleanupCycle(),
        worker2.runCleanupCycle(),
      ]);

      // Exactly one worker must have claimed and cleaned the document
      const totalCleaned = report1.expiredPendingCleaned + report2.expiredPendingCleaned;
      assert.strictEqual(totalCleaned, 1, 'Only one worker should clean the expired record');

      const after = await SharedFile.findById(expiredPending._id);
      assert.strictEqual(after?.status, 'FAILED');
      assert.strictEqual(after?.cleanupStatus, 'CLEANED');
      assert.strictEqual(after?.cleanupClaimedAt, null);
    });

    it('15.3 DEF-13-11: Expired lease recovery reclaims records abandoned by crashed workers (> 5 minutes)', async () => {
      const abandonedFile = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'abandoned.pdf',
        sanitizedFilename: 'abandoned.pdf',
        storageKey: `meetings/${meetingId}/abandoned/doc.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 300,
        status: 'PENDING',
        pendingExpiresAt: new Date(Date.now() - 600000), // 10 minutes ago
        cleanupStatus: 'NONE',
        cleanupClaimedAt: new Date(Date.now() - (CLEANUP_LEASE_DURATION_MS + 60000)), // Lease expired 1 min ago
        cleanupClaimedBy: 'crashed-worker-pid-99999',
        cleanupRetries: 0,
        isDeleted: false,
      });

      const worker = new FileCleanupWorker(memoryStorage);
      const report = await worker.runCleanupCycle();

      assert.ok(report.expiredPendingCleaned >= 1, 'Worker must reclaim and clean document with expired lease');

      const recovered = await SharedFile.findById(abandonedFile._id);
      assert.strictEqual(recovered?.status, 'FAILED');
      assert.strictEqual(recovered?.cleanupStatus, 'CLEANED');
    });

    it('15.4 DEF-13-12: Test A — Cleanup wins: atomic PENDING -> CLEANING transition blocks concurrent completion', async () => {
      const pendingFile = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'cleanup_wins.pdf',
        sanitizedFilename: 'cleanup_wins.pdf',
        storageKey: `meetings/${meetingId}/cleanup_wins.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 300,
        status: 'PENDING',
        pendingExpiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
        cleanupStatus: 'NONE',
        cleanupRetries: 0,
        isDeleted: false,
      });

      // Upload genuine file to memory storage
      await memoryStorage.uploadStream(
        pendingFile.storageKey,
        Readable.from(Buffer.from('%PDF-1.4\nCleanup wins content\n%%EOF')),
        'application/pdf',
        32
      );

      // Run cleanup cycle: worker claims and cleans it
      const worker = new FileCleanupWorker(memoryStorage);
      const report = await worker.runCleanupCycle();
      assert.strictEqual(report.expiredPendingCleaned, 1);

      // File is now FAILED and CLEANED
      const postCleanup = await SharedFile.findById(pendingFile._id);
      assert.strictEqual(postCleanup?.status, 'FAILED');
      assert.strictEqual(postCleanup?.cleanupStatus, 'CLEANED');

      // Attempting completion after cleanup claimed/failed must be rejected with FILE_EXPIRED_OR_CLEANED
      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), pendingFile._id.toString());
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_EXPIRED_OR_CLEANED');
          return true;
        }
      );
    });

    it('15.5 DEF-13-11: Repeated storage deletion failure transitions to STORAGE_DELETE_TERMINAL_FAILED on 5th retry', async () => {
      // Mock storage provider that always throws on deleteObject
      const failingStorage = {
        name: 'failing-s3',
        uploadStream: async () => ({ key: 'k', sizeBytes: 10 }),
        downloadStream: async () => { throw new Error('not supported'); },
        headObject: async () => ({ exists: true, sizeBytes: 10, contentType: 'application/pdf' }),
        readByteRange: async () => Buffer.from('test'),
        generatePresignedUploadUrl: async () => ({ uploadUrl: 'http://example.com' }),
        generatePresignedDownloadUrl: async () => 'http://example.com',
        deleteObject: async () => {
          throw new Error('S3 AWS HTTP 500 Internal Service Error');
        },
      };

      const failingFile = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'terminal_fail.pdf',
        sanitizedFilename: 'terminal_fail.pdf',
        storageKey: `meetings/${meetingId}/terminal_fail.pdf`,
        storageProvider: 'failing-s3',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 500,
        status: 'DELETED',
        cleanupStatus: 'STORAGE_DELETE_FAILED',
        cleanupRetries: 4, // 4 retries already failed; this cycle will be the 5th
        isDeleted: true,
      });

      const worker = new FileCleanupWorker(failingStorage as any);
      const report = await worker.runCleanupCycle();

      assert.strictEqual(report.failedDeletionsTerminated, 1, 'File must transition to terminal failure');

      const terminatedFile = await SharedFile.findById(failingFile._id);
      assert.strictEqual(terminatedFile?.cleanupStatus, 'STORAGE_DELETE_TERMINAL_FAILED');
      assert.strictEqual(terminatedFile?.cleanupRetries, 5);
      assert.ok(
        terminatedFile?.cleanupLastError?.includes('S3 AWS HTTP 500 Internal Service Error'),
        'cleanupLastError must record storage error message'
      );
    });

    it('15.6 DEF-13-11: recoverOrphanedTempDiskFiles unlinks abandoned upload files older than 1 hour', async () => {
      const uploadDir = path.join(os.tmpdir(), 'connectly_uploads');
      await fs.mkdir(uploadDir, { recursive: true });
      const testTempFile = path.join(uploadDir, `connectly_orphan_test_${Date.now()}.tmp`);

      // Write a dummy temp file
      await fs.writeFile(testTempFile, 'abandoned temp upload content');

      // Set modification and access time to 2 hours ago
      const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
      await (await import('node:fs')).promises.utimes(testTempFile, twoHoursAgo, twoHoursAgo);

      const worker = new FileCleanupWorker(memoryStorage);
      const removedCount = await worker.recoverOrphanedTempDiskFiles();

      assert.ok(removedCount >= 1, 'Worker must remove orphaned temp disk file');

      // Verify file is gone
      const exists = await fs.access(testTempFile).then(() => true).catch(() => false);
      assert.strictEqual(exists, false, 'Abandoned temporary file must be unlinked');
    });

    it('15.7 DEF-13-12: Test B — Completion wins: PENDING -> AVAILABLE blocks subsequent cleanup claim', async () => {
      const init = await customFileService.initPresignedUpload(meetingCode, hostUser._id.toString(), {
        filename: 'completion_wins.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 250,
      });

      const fileDoc = await SharedFile.findById(init.fileId);
      const pdfBytes = Buffer.from('%PDF-1.4\nCompletion wins content\n%%EOF');
      await memoryStorage.uploadStream(fileDoc!.storageKey, Readable.from(pdfBytes), 'application/pdf', pdfBytes.length);

      // Complete upload: transitions to AVAILABLE
      const completed = await customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), init.fileId);
      assert.strictEqual(completed.status, 'AVAILABLE');

      // Now run cleanup cycle
      const worker = new FileCleanupWorker(memoryStorage);
      await worker.runCleanupCycle();

      // Cleanup must NOT claim or clean this file
      const postCheck = await SharedFile.findById(init.fileId);
      assert.strictEqual(postCheck?.status, 'AVAILABLE');
      assert.strictEqual(postCheck?.cleanupStatus, 'NONE');

      // Storage object must remain intact and downloadable
      const download = await customFileService.getFileForDownload(meetingCode, guestUser._id.toString(), init.fileId);
      assert.ok(download.stream);
    });

    it('15.8 DEF-13-12: Test C — Race after claim: worker pauses in CLEANING; completion is rejected', async () => {
      const pendingFile = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'race_pause.pdf',
        sanitizedFilename: 'race_pause.pdf',
        storageKey: `meetings/${meetingId}/race_pause.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 280,
        status: 'PENDING',
        pendingExpiresAt: new Date(Date.now() - 30000), // Expired
        cleanupStatus: 'NONE',
        cleanupRetries: 0,
        isDeleted: false,
      });

      await memoryStorage.uploadStream(
        pendingFile.storageKey,
        Readable.from(Buffer.from('%PDF-1.4\nPaused content\n%%EOF')),
        'application/pdf',
        30
      );

      // Simulate Worker claiming the record into CLEANING state with claimToken
      const claimToken = crypto.randomUUID();
      const claimed = await SharedFile.findOneAndUpdate(
        { _id: pendingFile._id, status: 'PENDING' },
        {
          $set: {
            status: 'CLEANING',
            cleanupClaimedAt: new Date(),
            cleanupClaimedBy: 'paused_worker_1',
            cleanupClaimToken: claimToken,
          },
        },
        { new: true }
      );
      assert.strictEqual(claimed?.status, 'CLEANING');

      // While in CLEANING, completion attempt must be rejected
      await assert.rejects(
        async () => {
          await customFileService.completePresignedUpload(meetingCode, hostUser._id.toString(), pendingFile._id.toString());
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FILE_EXPIRED_OR_CLEANED');
          return true;
        }
      );

      // Verify status remained CLEANING and was NOT overwritten to AVAILABLE
      const checkDoc = await SharedFile.findById(pendingFile._id);
      assert.strictEqual(checkDoc?.status, 'CLEANING');
    });

    it('15.9 DEF-13-12: Test D — Stale worker: worker losing claimToken fence cannot delete storage or overwrite DB', async () => {
      const storageKey = `meetings/${meetingId}/stale_fenced.pdf`;
      await memoryStorage.uploadStream(
        storageKey,
        Readable.from(Buffer.from('%PDF-1.4\nFenced content\n%%EOF')),
        'application/pdf',
        30
      );

      const staleToken = 'worker_a_stale_token';
      const newToken = 'worker_b_new_authoritative_token';

      const fileDoc = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'stale_fenced.pdf',
        sanitizedFilename: 'stale_fenced.pdf',
        storageKey,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 300,
        status: 'CLEANING',
        cleanupStatus: 'NONE',
        cleanupClaimedAt: new Date(),
        cleanupClaimedBy: 'worker_b',
        cleanupClaimToken: newToken, // Authoritative token belongs to Worker B
        isDeleted: false,
      });

      // Worker A attempts to finalize using stale token
      const staleFinalize = await SharedFile.updateOne(
        {
          _id: fileDoc._id,
          status: 'CLEANING',
          cleanupClaimToken: staleToken, // Worker A's stale token
        },
        {
          $set: {
            status: 'FAILED',
            cleanupStatus: 'CLEANED',
          },
        }
      );

      // Stale finalize MUST match 0 documents
      assert.strictEqual(staleFinalize.matchedCount, 0);
      assert.strictEqual(staleFinalize.modifiedCount, 0);

      // Verify document still has Worker B's token
      const currentDoc = await SharedFile.findById(fileDoc._id);
      assert.strictEqual(currentDoc?.cleanupClaimToken, newToken);
    });

    it('15.10 DEF-13-12: Test E — Crash recovery: lease expiry reclaims CLEANING records safely', async () => {
      const crashedRecord = await SharedFile.create({
        meetingId: new mongoose.Types.ObjectId(meetingId),
        uploaderId: hostUser._id,
        uploaderName: hostUser.firstName,
        uploaderRole: 'host',
        originalFilename: 'crashed_worker.pdf',
        sanitizedFilename: 'crashed_worker.pdf',
        storageKey: `meetings/${meetingId}/crashed_worker.pdf`,
        storageProvider: 'memory',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 300,
        status: 'CLEANING',
        pendingExpiresAt: new Date(Date.now() - 600000),
        cleanupStatus: 'NONE',
        cleanupClaimedAt: new Date(Date.now() - (CLEANUP_LEASE_DURATION_MS + 30000)), // Lease expired
        cleanupClaimedBy: 'crashed_worker_pid_123',
        cleanupClaimToken: 'crashed_token_123',
        cleanupRetries: 0,
        isDeleted: false,
      });

      const worker = new FileCleanupWorker(memoryStorage);
      const report = await worker.runCleanupCycle();

      assert.strictEqual(report.expiredPendingCleaned, 1, 'Worker must safely recover expired CLEANING lease');

      const recovered = await SharedFile.findById(crashedRecord._id);
      assert.strictEqual(recovered?.status, 'FAILED');
      assert.strictEqual(recovered?.cleanupStatus, 'CLEANED');
      assert.strictEqual(recovered?.cleanupClaimToken, null);
    });
  });

  describe('16. DEF-13-14: S3 Bucket Versioning Startup Enforcement', () => {
    it('16.1 DEF-13-14: verifyBucketVersioning accepts Enabled status', async () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      // Mock client send to return Status: 'Enabled'
      (s3Provider as any).client = {
        send: async () => ({ Status: 'Enabled' }),
      };

      const result = await s3Provider.verifyBucketVersioning();
      assert.strictEqual(result, true);
    });

    it('16.2 DEF-13-14: verifyBucketVersioning throws S3_VERSIONING_REQUIRED when Status is Suspended', async () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      (s3Provider as any).client = {
        send: async () => ({ Status: 'Suspended' }),
      };

      await assert.rejects(
        async () => {
          await s3Provider.verifyBucketVersioning();
        },
        (err: any) => {
          assert.strictEqual(err.code, 'S3_VERSIONING_REQUIRED');
          assert.ok(err.message.includes('Suspended'));
          return true;
        }
      );
    });

    it('16.3 DEF-13-14: verifyBucketVersioning throws S3_VERSIONING_REQUIRED when Status is absent or Disabled', async () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      (s3Provider as any).client = {
        send: async () => ({ Status: undefined }),
      };

      await assert.rejects(
        async () => {
          await s3Provider.verifyBucketVersioning();
        },
        (err: any) => {
          assert.strictEqual(err.code, 'S3_VERSIONING_REQUIRED');
          assert.ok(err.message.includes('Disabled'));
          return true;
        }
      );
    });

    it('16.4 DEF-13-14: verifyBucketVersioning throws S3_VERSIONING_REQUIRED on AWS network or permission error', async () => {
      const s3Provider = new S3StorageProvider({
        bucket: 'connectly-test-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      (s3Provider as any).client = {
        send: async () => {
          throw new Error('Access Denied: s3:GetBucketVersioning permission missing');
        },
      };

      await assert.rejects(
        async () => {
          await s3Provider.verifyBucketVersioning();
        },
        (err: any) => {
          assert.strictEqual(err.code, 'S3_VERSIONING_REQUIRED');
          assert.ok(err.message.includes('s3:GetBucketVersioning'));
          return true;
        }
      );
    });
  });
});
