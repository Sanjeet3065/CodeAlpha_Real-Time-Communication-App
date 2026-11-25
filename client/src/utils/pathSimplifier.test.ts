import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  perpendicularDistance,
  filterMinDistance,
  ramerDouglasPeucker,
  simplifyFreehandPath,
} from './pathSimplifier.ts';
import type { WhiteboardPoint } from '@/types/whiteboard';

describe('Phase 17 — DEF-17-04 Whiteboard Path Simplification Suite', () => {
  it('1. perpendicularDistance: computes exact distance to collinear and perpendicular points', () => {
    const a: WhiteboardPoint = { x: 0, y: 0 };
    const b: WhiteboardPoint = { x: 100, y: 0 };

    // Point on line: distance should be 0
    const onLine: WhiteboardPoint = { x: 50, y: 0 };
    assert.strictEqual(perpendicularDistance(onLine, a, b), 0);

    // Point 10 units above line: distance should be 10
    const aboveLine: WhiteboardPoint = { x: 50, y: 10 };
    assert.strictEqual(Math.round(perpendicularDistance(aboveLine, a, b)), 10);
  });

  it('2. filterMinDistance: removes sub-pixel consecutive jitter while preserving endpoints', () => {
    const points: WhiteboardPoint[] = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.1 }, // sub-pixel delta (< 1.5)
      { x: 0.5, y: 0.3 }, // sub-pixel delta (< 1.5)
      { x: 10, y: 10 },   // large jump (> 1.5)
      { x: 10.3, y: 10.1 },// sub-pixel delta (< 1.5)
      { x: 20, y: 20 },   // final endpoint
    ];

    const filtered = filterMinDistance(points, 1.5);

    // Endpoints must be strictly preserved
    assert.deepStrictEqual(filtered[0], { x: 0, y: 0 });
    assert.deepStrictEqual(filtered[filtered.length - 1], { x: 20, y: 20 });
    // Middle subpixel points removed
    assert.strictEqual(filtered.length, 3);
  });

  it('3. ramerDouglasPeucker: decimates straight lines of 100 points into exactly 2 points', () => {
    const points: WhiteboardPoint[] = [];
    for (let i = 0; i <= 100; i++) {
      points.push({ x: i * 2, y: i * 2 }); // straight line from (0,0) to (200,200)
    }

    const simplified = ramerDouglasPeucker(points, 1.0);
    assert.strictEqual(simplified.length, 2);
    assert.deepStrictEqual(simplified[0], { x: 0, y: 0 });
    assert.deepStrictEqual(simplified[1], { x: 200, y: 200 });
  });

  it('4. ramerDouglasPeucker: preserves prominent corners and curves with high fidelity', () => {
    // A path that has a 90-degree corner at (50, 0)
    const points: WhiteboardPoint[] = [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 50, y: 0 },  // sharp corner
      { x: 50, y: 25 },
      { x: 50, y: 50 }, // end
    ];

    const simplified = ramerDouglasPeucker(points, 1.0);
    // Must preserve start (0,0), corner (50,0), and end (50,50)
    assert.strictEqual(simplified.length, 3);
    assert.deepStrictEqual(simplified[0], { x: 0, y: 0 });
    assert.deepStrictEqual(simplified[1], { x: 50, y: 0 });
    assert.deepStrictEqual(simplified[2], { x: 50, y: 50 });
  });

  it('5. simplifyFreehandPath: achieves 60%–75% reduction on high-density curved stroke', () => {
    // Simulate a freehand circle/arc with 180 points
    const rawPoints: WhiteboardPoint[] = [];
    for (let deg = 0; deg <= 180; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      rawPoints.push({
        x: Math.round((100 + 80 * Math.cos(rad)) * 10) / 10,
        y: Math.round((100 + 80 * Math.sin(rad)) * 10) / 10,
      });
    }

    const rawSize = JSON.stringify(rawPoints).length;
    const simplified = simplifyFreehandPath(rawPoints, 1.2, 1.5);
    const simplifiedSize = JSON.stringify(simplified).length;

    const pointReduction = (1 - simplified.length / rawPoints.length) * 100;
    const payloadReduction = (1 - simplifiedSize / rawSize) * 100;

    assert.ok(pointReduction >= 60, `Point count reduction must be >= 60% (achieved ${pointReduction.toFixed(1)}%)`);
    assert.ok(payloadReduction >= 60, `Payload size reduction must be >= 60% (achieved ${payloadReduction.toFixed(1)}%)`);
    // Exact endpoints preserved
    assert.deepStrictEqual(simplified[0], rawPoints[0]);
    assert.deepStrictEqual(simplified[simplified.length - 1], rawPoints[rawPoints.length - 1]);
  });

  it('6. Edge cases: handles single-point, two-point, empty, and closed loop paths safely', () => {
    // Empty array
    assert.deepStrictEqual(simplifyFreehandPath([]), []);

    // Single-point dot
    const singlePoint: WhiteboardPoint[] = [{ x: 42, y: 84 }];
    assert.deepStrictEqual(simplifyFreehandPath(singlePoint), [{ x: 42, y: 84 }]);

    // Two-point segment
    const twoPoints: WhiteboardPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    assert.deepStrictEqual(simplifyFreehandPath(twoPoints), twoPoints);

    // Closed loop (circle where start == end)
    const closedLoop: WhiteboardPoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
      { x: 50, y: -50 },
      { x: 0, y: 0 }, // Closed back to origin
    ];
    const simplifiedLoop = simplifyFreehandPath(closedLoop, 1.0, 1.0);
    assert.deepStrictEqual(simplifiedLoop[0], { x: 0, y: 0 });
    assert.deepStrictEqual(simplifiedLoop[simplifiedLoop.length - 1], { x: 0, y: 0 });
    assert.ok(simplifiedLoop.length >= 4, 'Closed loop must preserve diamond vertices');
  });
});
