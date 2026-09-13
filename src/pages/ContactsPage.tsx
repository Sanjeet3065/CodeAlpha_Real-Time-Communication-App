import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Search, Check, X, UserMinus, Users, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { EmptyState } from '@/components/LoadingStates';
import { useAuthStore } from '@/stores/authStore';
import { searchUsers, getContacts, sendContactRequest, acceptContactRequest, rejectContactRequest, removeContact } from '@/services/meetingApi';
import { UserAvatar } from '@/components/UserAvatar';
import { toast } from '@/stores/toastStore';
import type { Profile, Contact as ContactType } from '@/types';

export function ContactsPage() {
  const [searchParams] = useSearchParams();
  const profile = useAuthStore((s) => s.profile);
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<ContactType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'all' | 'pending'>('all');

  useEffect(() => {
    loadContacts();
    if (searchParams.get('q')) doSearch(searchParams.get('q')!);
  }, [searchParams]);

  async function loadContacts() {
    try {
      const c = await getContacts();
      setContacts(c);
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function doSearch(q: string) {
    setQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const results = await searchUsers(q);
      setSearchResults(results.filter((r) => r.id !== profile?.id));
    } catch (err) {
      // silent
    } finally {
      setSearching(false);
    }
  }

  async function handleSendRequest(userId: string) {
    try {
      await sendContactRequest(userId);
      toast.success('Contact request sent');
      setSearchResults((prev) => prev.filter((r) => r.id !== userId));
    } catch (err: any) {
      toast.error('Failed to send request');
    }
  }

  async function handleAccept(id: string) {
    try {
      await acceptContactRequest(id);
      toast.success('Contact accepted');
      loadContacts();
    } catch (err) {
      toast.error('Failed to accept');
    }
  }

  async function handleReject(id: string) {
    try {
      await rejectContactRequest(id);
      toast.info('Request rejected');
      loadContacts();
    } catch (err) {
      toast.error('Failed to reject');
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeContact(id);
      toast.success('Contact removed');
      loadContacts();
    } catch (err) {
      toast.error('Failed to remove');
    }
  }

  const filteredContacts = tab === 'pending'
    ? contacts.filter((c) => c.status === 'pending')
    : contacts;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Contacts</h1>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => doSearch(e.target.value)}
            placeholder="Search users by name or email..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Search results */}
        {query.trim() && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Search Results</h2>
            {searching ? (
              <div className="flex items-center gap-2 text-gray-400 py-4"><Loader2 className="w-5 h-5 animate-spin" /> Searching...</div>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No users found.</p>
            ) : (
              <div className="space-y-2">
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                    <UserAvatar
                      name={u.full_name}
                      email={u.email}
                      avatarUrl={u.avatar_url}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.full_name}</p>
                      <p className="text-xs text-gray-500 truncate">{u.email}</p>
                    </div>
                    <button
                      onClick={() => handleSendRequest(u.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
                    >
                      <UserPlus className="w-4 h-4" /> Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contacts tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            All Contacts
          </button>
          <button
            onClick={() => setTab('pending')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'pending' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            Pending Requests
          </button>
        </div>

        {/* Contacts list */}
        {loading ? (
          <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" /></div>
        ) : filteredContacts.length === 0 ? (
          <EmptyState
            icon={<Users className="w-8 h-8" />}
            title={tab === 'pending' ? 'No pending requests' : 'No contacts yet'}
            description={tab === 'pending' ? 'You have no pending contact requests.' : 'Search for users above to add contacts.'}
          />
        ) : (
          <div className="space-y-2">
            {filteredContacts.map((c) => {
              const isRequester = c.requester_id === profile?.id;
              const otherProfile = isRequester ? (c as any).addressee : (c as any).requester;
              return (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                  <UserAvatar
                    name={otherProfile?.full_name}
                    email={otherProfile?.email}
                    avatarUrl={otherProfile?.avatar_url}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{otherProfile?.full_name || 'User'}</p>
                    <p className="text-xs text-gray-500 truncate">{otherProfile?.email}</p>
                  </div>
                  {c.status === 'pending' && !isRequester && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleAccept(c.id)} className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 transition">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleReject(c.id)} className="w-8 h-8 rounded-lg bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {c.status === 'pending' && isRequester && (
                    <span className="text-xs text-amber-500 font-medium">Pending</span>
                  )}
                  {c.status === 'accepted' && (
                    <button onClick={() => handleRemove(c.id)} className="w-8 h-8 rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30 flex items-center justify-center transition">
                      <UserMinus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
