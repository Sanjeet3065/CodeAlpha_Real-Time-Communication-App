import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ArrowRight, Loader2 } from 'lucide-react';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { getMeetingByCode } from '@/services/meetingApi';
import { toast } from '@/stores/toastStore';

export function JoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!code.trim()) {
      toast.error('Please enter a meeting code');
      return;
    }
    setLoading(true);
    try {
      const normalizedCode = code.trim().toUpperCase();
      const meeting = await getMeetingByCode(normalizedCode);
      if (!meeting) {
        toast.error('Meeting not found. Check the code and try again.');
        return;
      }
      if (meeting.status === 'ended') {
        toast.error('This meeting has ended.');
        return;
      }
      navigate(`/lobby/${meeting.code}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to find meeting');
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Join a Meeting</h1>
          <p className="text-gray-500 dark:text-gray-400">Enter the meeting code to join</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Meeting Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-EFGH-IJKL"
            className="w-full px-4 py-4 text-center text-xl font-mono uppercase tracking-widest rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition"
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            autoFocus
          />
          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full mt-4 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Join Meeting <ArrowRight className="w-4 h-4" /></>}
          </button>
          <p className="text-center text-xs text-gray-400 mt-4">
            Don't have a code? Ask the host to share the meeting link or code with you.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
