import { useEffect, useState, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';

interface IProfile {
  id: string;
  telegramNick: string;
  balanceMain: string;
}

interface Props {
  tgId: string;
  onBalanceUpdate?: () => void;
}

const getInitData = () => {
  try { return WebApp.initData || ''; } catch { return ''; }
};

export default function ProfileScreen({ tgId, onBalanceUpdate }: Props) {
  const [profile, setProfile]   = useState<IProfile | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!tgId) return;
    try {
      const res = await fetch(`/api/users/profile?tgId=${tgId}`, {
        headers: { 'x-telegram-init-data': getInitData() },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setProfile(result.data);
        setError(null);
      } else {
        throw new Error(result.message ?? 'Ошибка загрузки профиля');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tgId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleWithdraw = async () => {
    if (!profile || withdrawing) return;
    const amountStr = prompt('Введите сумму вывода (мин. 100 ₽):');
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount < 100) {
      alert('Минимальная сумма вывода — 100 ₽');
      return;
    }
    if (amount > parseFloat(profile.balanceMain)) {
      alert('Недостаточно средств на балансе.');
      return;
    }

    setWithdrawing(true);
    try {
      const idempotencyKey = `wd_${tgId}_${Date.now()}`;
      const res = await fetch('/api/products/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({ userId: tgId, amountRubles: amount, idempotencyKey }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? 'Ошибка вывода');

      try { WebApp.HapticFeedback.notificationOccurred('success'); } catch {}
      alert(
        `✅ Заявка принята!\n` +
        `К зачислению: ${result.data.payoutRubles} ₽\n` +
        `Комиссия банка: ${result.data.feeRubles} ₽`
      );
      await loadProfile();
      onBalanceUpdate?.();
    } catch (err) {
      try { WebApp.HapticFeedback.notificationOccurred('error'); } catch {}
      alert(`❌ Ошибка вывода: ${(err as Error).message}`);
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) return <div style={{ color: '#444', textAlign: 'center', padding: '40px', fontFamily: 'monospace' }}>ЗАГРУЗКА ПРОФИЛЯ...</div>;
  if (error)   return <div style={{ color: '#ff4757', textAlign: 'center', padding: '40px', fontFamily: 'monospace' }}>❌ {error}</div>;
  if (!profile) return null;

  const isAdmin = tgId === (import.meta.env.VITE_ADMIN_TG_ID ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Карточка трейдера */}
      <div style={{ background: '#030303', border: '1px solid #222', padding: '16px', borderRadius: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>
              {isAdmin ? '👑 ' : '👤 '}@{profile.telegramNick}
            </div>
            <div style={{ fontSize: '9px', color: isAdmin ? '#ff9f43' : '#555', marginTop: '3px' }}>
              {isAdmin ? 'АДМИНИСТРАТОР ONIX' : `ACC #${profile.id}`}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '8px', color: '#555' }}>БАЛАНС</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#1dd1a1' }}>
              {parseFloat(profile.balanceMain).toFixed(2)} ₽
            </div>
          </div>
        </div>

        <button
          onClick={handleWithdraw}
          disabled={withdrawing || parseFloat(profile.balanceMain) < 100}
          style={{
            width: '100%', marginTop: '14px', padding: '12px',
            background: withdrawing || parseFloat(profile.balanceMain) < 100 ? '#1a1a1a' : '#1dd1a1',
            color: withdrawing || parseFloat(profile.balanceMain) < 100 ? '#555' : '#000',
            border: 'none', borderRadius: '4px',
            fontSize: '12px', fontWeight: 'bold',
            cursor: withdrawing || parseFloat(profile.balanceMain) < 100 ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
          }}
        >
          {withdrawing ? 'ОБРАБОТКА...' : '💳 ВЫВОД НА КАРТУ (комиссия 50 ₽)'}
        </button>
      </div>

      {/* Секция отзывов */}
      <ReviewsSection tgId={tgId} />
    </div>
  );
}

// ── Отзывы ───────────────────────────────────────────────────────────────────

interface IReview { id: string; author: string; text: string; rating: string; createdAt: string }

function ReviewsSection({ tgId }: { tgId: string }) {
  const [reviews, setReviews]   = useState<IReview[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [text, setText]         = useState('');
  const [rating, setRating]     = useState('⭐️⭐️⭐️⭐️⭐️');
  const [sending, setSending]   = useState(false);

  useEffect(() => {
    fetch('/api/chat/reviews', { headers: { 'x-telegram-init-data': '' } })
      .then(r => r.json())
      .then(r => { if (r.success) setReviews(r.data); })
      .catch(console.error);
  }, []);

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/chat/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorTgId: tgId, text: text.trim(), rating }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message);
      setReviews(prev => [result.data, ...prev]);
      setText(''); setShowForm(false);
    } catch (err) {
      alert(`Ошибка: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ background: '#030303', border: '1px solid #222', padding: '16px', borderRadius: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>// ⭐️ ОТЗЫВЫ</div>
        <button
          onClick={() => setShowForm(f => !f)}
          style={{ background: 'none', border: '1px solid #333', color: '#555', padding: '5px 10px', fontSize: '10px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}
        >
          {showForm ? 'ОТМЕНА' : '+ НАПИСАТЬ'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submitReview} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          <select value={rating} onChange={e => setRating(e.target.value)}
            style={{ background: '#000', border: '1px solid #222', color: '#fff', padding: '8px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}>
            {['⭐️⭐️⭐️⭐️⭐️','⭐️⭐️⭐️⭐️','⭐️⭐️⭐️','⭐️⭐️','⭐️'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Ваш отзыв..." maxLength={500} required
            style={{ background: '#000', border: '1px solid #222', color: '#fff', padding: '8px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', height: '60px', resize: 'none' }} />
          <button type="submit" disabled={sending}
            style={{ padding: '10px', background: sending ? '#1a1a1a' : '#fff', color: sending ? '#555' : '#000', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: sending ? 'not-allowed' : 'pointer', fontFamily: 'monospace' }}>
            {sending ? 'ОТПРАВКА...' : 'ОПУБЛИКОВАТЬ'}
          </button>
        </form>
      )}

      {reviews.length === 0 ? (
        <div style={{ color: '#333', fontSize: '11px', textAlign: 'center', padding: '20px' }}>Отзывов пока нет.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {reviews.map(r => (
            <div key={r.id} style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#ff9f43', fontSize: '11px' }}>{r.rating}</span>
                <span style={{ color: '#444', fontSize: '10px' }}>@{r.author}</span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: '#aaa', lineHeight: '1.4' }}>{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}