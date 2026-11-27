import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Inbox,
  Calendar,
  Clock,
  AlertTriangle,
  Mail,
  CheckCheck,
} from 'lucide-react';
import { schedulingApi } from '@/services/schedulingApi';
import { meetingSocket } from '@/services/meetingSocket';
import { cn } from '@/lib/utils';
import type { IInAppNotification } from '@/types/scheduling';

interface NotificationsPopoverProps {
  triggerClassName?: string;
}

export const NotificationsPopover: React.FC<NotificationsPopoverProps> = ({
  triggerClassName,
}) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<IInAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await schedulingApi.listNotifications({ page: 1, limit: 15 });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // Graceful fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Real-time synchronization
    const socket = meetingSocket.getSocket();
    if (socket) {
      const handleNewNotification = (notif: IInAppNotification) => {
        setNotifications((prev) => [notif, ...prev.slice(0, 14)]);
        setUnreadCount((prev) => prev + 1);
      };

      socket.on('notification:new', handleNewNotification);
      return () => {
        socket.off('notification:new', handleNewNotification);
      };
    }
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Close on Escape key and return focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await schedulingApi.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Best-effort notification read state update
      void 0;
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await schedulingApi.markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch {
      // Best-effort notification read state update
      void 0;
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'MEETING_INVITATION':
        return <Mail className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" />;
      case 'MEETING_REMINDER':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'MEETING_RESCHEDULED':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'MEETING_CANCELLED':
        return <AlertTriangle className="w-4 h-4 text-rose-500" />;
      default:
        return <Bell className="w-4 h-4 text-[#7C848D] dark:text-[#A3AAB2]" />;
    }
  };

  return (
    <div className="relative inline-block text-left" ref={popoverRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`View notifications (${unreadCount} unread)`}
        className={cn(
          'relative p-1.5 sm:p-2 rounded-lg text-[#7C848D] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] hover:bg-[#F3F2EE] dark:hover:bg-[#24282E] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/30 dark:focus:ring-[#5FA399]/30',
          triggerClassName
        )}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-[#FAF9F6] dark:ring-[#141619]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="region"
          aria-label="Notifications"
          className="origin-top-right absolute right-0 mt-2 w-80 sm:w-96 rounded-xl shadow-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] focus:outline-none z-50 animate-in fade-in-50 zoom-in-95 duration-100 max-h-[80vh] flex flex-col"
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between p-3.5 border-b border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE]/80 dark:bg-[#141619]/80 rounded-t-xl shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] uppercase tracking-wider">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-500/30 font-semibold">
                  {unreadCount} New
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[11px] font-semibold text-[#2F6F68] dark:text-[#5FA399] hover:text-[#255A54] dark:hover:text-[#6EB2A8] flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Popover Body */}
          <div className="overflow-y-auto flex-1 divide-y divide-[#DDDAD0]/70 dark:divide-[#2B3038]">
            {isLoading && notifications.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">Loading notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-10 h-10 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center mx-auto mb-2.5">
                  <Inbox className="w-5 h-5" aria-hidden="true" />
                </div>
                <p className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] mb-1">
                  No New Notifications
                </p>
                <p className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2] leading-relaxed max-w-xs mx-auto">
                  You are all caught up! When meetings are scheduled, rescheduled, or reminders fire, alerts will appear here.
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.read) handleMarkAsRead(notif.id);
                    if (notif.meetingCode && notif.type !== 'MEETING_CANCELLED') {
                      navigate(`/lobby/${notif.meetingCode}`);
                      setIsOpen(false);
                    }
                  }}
                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer hover:bg-[#EAE8E1]/70 dark:hover:bg-[#24282E] ${
                    !notif.read ? 'bg-[#E2ECE9]/40 dark:bg-[#1F302E]/50' : ''
                  }`}
                >
                  <div className="mt-0.5 p-1.5 rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] shrink-0">
                    {renderIcon(notif.type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-xs font-bold text-[#1F2428] dark:text-[#EAECEE] truncate">
                        {notif.title}
                      </p>
                      {!notif.read && (
                        <span className="w-2 h-2 rounded-full bg-[#2F6F68] dark:bg-[#5FA399] shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#7C848D] dark:text-[#A3AAB2] line-clamp-2 leading-relaxed">
                      {notif.message}
                    </p>
                    <span className="text-[10px] text-[#7C848D]/75 dark:text-[#747C86] mt-1 block">
                      {new Date(notif.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
