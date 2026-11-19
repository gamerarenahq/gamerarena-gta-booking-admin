'use client'

import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Calendar, Monitor, User, Phone, Plus, Minus, AlertTriangle, ShieldCheck, Check, Trash2, Edit2, Rocket, Lock, X, MessageCircle, CheckCircle2, Timer } from 'lucide-react';

const SYSTEMS = ['PS1', 'PS2', 'PS3'];
const OPENING_MINS = 600; // 10:00 AM
const CLOSING_MINS = 1440; // 12:00 AM (Midnight)
const MIN_SLOT_MINS = 60; // Ignore gaps under 1 hour (such as 30-min gaps)

type Booking = {
  id: number;
  customer_name: string;
  phone_number: string;
  system_id: string;
  booking_date: string;
  start_time: string;
  duration: number;
  status: string;
};

type ActiveSale = {
  customer: string;
  system: string;
  status: string;
};

type TimeWindow = {
  start: number;
  end: number;
};

// --- Helper Functions ---
const timeToMinutes = (timeStr: string) => {
  if (!timeStr) return 0;
  if (timeStr.includes('AM') || timeStr.includes('PM')) {
    const parts = timeStr.trim().split(/\s+/);
    const time = parts[0];
    const modifier = parts[1];

    const timeParts = time.split(':').map(Number);
    let h = timeParts[0];
    const m = timeParts[1];

    if (modifier === 'PM' && h !== 12) h += 12;
    if (modifier === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const parts24 = timeStr.split(':').map(Number);
  return parts24[0] * 60 + parts24[1];
};

const minutesTo12Hour = (mins: number) => {
  const clamped = Math.max(0, Math.min(1440, Math.round(mins)));
  if (clamped === 1440) return '12:00 AM';
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const format12Hour = (time24: string) => {
  if (!time24) return '';
  const parts = time24.split(':');
  let h = parseInt(parts[0], 10);
  const mStr = parts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h.toString().padStart(2, '0')}:${mStr} ${ampm}`;
};

const getISTParts = () => {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const dateStr = dateFormatter.format(now);
  const timeStr = timeFormatter.format(now);
  const [h, m, s] = timeStr.split(':').map(Number);

  return {
    dateStr,
    currentMinutes: h * 60 + m,
    currentSeconds: h * 3600 + m * 60 + s,
  };
};

const getTodayString = () => getISTParts().dateStr;

// Calculates base cost for PS5
const getPrice = (dur: number, extra: number = 0) => {
  const full = Math.floor(dur);
  const half = (dur % 1 !== 0) ? 1 : 0;
  return (full * (150 + (extra * 100))) + (half * (100 + (extra * 100)));
};

const buildWhatsAppText = (b: Booking) => {
  const parts = b.booking_date.split('-');
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  const niceDate = `${d} ${dateObj.toLocaleString('en-US', { month: 'short' })} ${y}`;

  return `Dear *${b.customer_name}*,\n\nThank you for choosing Gamerarena! Your exclusive GTA VI slot has been successfully secured. Here are your booking details:\n\n📅 *Date:* ${niceDate}\n⏰ *Start Time:* ${b.start_time}\n⏳ *Duration:* ${b.duration} Hours\n🎮 *Console:* ${b.system_id}\n\n*⚠️ House Rules for Launch Week:*\n• *10-Minute Grace Period:* If you arrive more than 10 minutes late, your slot may be reassigned to the next waiting player.\n• *Hard Stops:* To ensure everyone gets their turn, sessions must end strictly on time if another gamer is scheduled after you.\n\nSee you at the arena! 🎮`;
};

const getAvailableSlots1HrPlus = (
  sysBookings: Booking[],
  selectedDate: string,
  istNow: { dateStr: string; currentMinutes: number }
): TimeWindow[] => {
  if (selectedDate < istNow.dateStr) return [];

  // If viewing today, start checking from current IST time (rounded up to next 5 mins)
  const roundedNow = Math.ceil(istNow.currentMinutes / 5) * 5;
  const startBoundary =
    selectedDate === istNow.dateStr
      ? Math.max(OPENING_MINS, roundedNow)
      : OPENING_MINS;

  if (startBoundary >= CLOSING_MINS) return [];

  const blocks = sysBookings
    .map((b) => {
      const start = timeToMinutes(b.start_time);
      const end = start + Number(b.duration) * 60;
      return { start, end };
    })
    .filter((block) => block.end > startBoundary && block.start < CLOSING_MINS)
    .sort((a, b) => a.start - b.start);

  const windows: TimeWindow[] = [];
  let cursor = startBoundary;

  for (const block of blocks) {
    const effectiveStart = Math.max(cursor, startBoundary);
    const effectiveEnd = Math.min(block.start, CLOSING_MINS);

    if (effectiveEnd - effectiveStart >= MIN_SLOT_MINS) {
      windows.push({ start: effectiveStart, end: effectiveEnd });
    }

    cursor = Math.max(cursor, Math.min(block.end, CLOSING_MINS));
  }

  if (CLOSING_MINS - cursor >= MIN_SLOT_MINS) {
    windows.push({ start: cursor, end: CLOSING_MINS });
  }

  return windows;
};

export default function GTADashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');

  // Automatically snaps to current IST date on load
  const [dateFilter, setDateFilter] = useState(() => getTodayString());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => getISTParts());

  // Modal State
  const [modal, setModal] = useState<string | null>(null); // 'booking', 'push', 'whatsapp', null
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Form State (For Create/Edit)
  const [formSystem, setFormSystem] = useState('PS1');
  const [formDate, setFormDate] = useState(dateFilter);
  const [startTime24, setStartTime24] = useState('');
  const [duration, setDuration] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const fetchBookings = async (silent = false) => {
    if (!silent) setIsFetching(true);
    try {
      const [bookingsRes, salesRes] = await Promise.all([
        supabase.from('gta_bookings').select('*').eq('booking_date', dateFilter),
        supabase.from('sales').select('customer, system, status').eq('date', dateFilter).eq('status', 'Active'),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;

      const activeSales = (salesRes.data || []) as ActiveSale[];
      const rawBookings = (bookingsRes.data || []) as Booking[];

      // Auto-hide bookings that were Pushed to Live Floor once closed in POS
      const visibleBookings = rawBookings.filter((b) => {
        if (b.status !== 'Pushed') return true;
        const stillActiveOnFloor = activeSales.some(
          (s) =>
            s.system === b.system_id &&
            s.customer.trim().toLowerCase() === b.customer_name.trim().toLowerCase()
        );
        return stillActiveOnFloor;
      });

      const sorted = visibleBookings.sort(
        (a: Booking, b: Booking) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
      );
      setBookings(sorted);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      if (!silent) setIsFetching(false);
    }
  };

  // Live clock tick & silent POS sync every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(getISTParts());
      if (isAuthenticated) {
        fetchBookings(true);
      }
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, isAuthenticated]);

  // Fetch bookings when date changes or after login
  useEffect(() => {
    if (isAuthenticated) fetchBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, isAuthenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'gta2026') {
      setIsAuthenticated(true);
    } else {
      alert('Incorrect PIN');
    }
  };

  const openCreateModal = () => {
    setSelectedBooking(null);
    setFormSystem('PS1');
    setFormDate(dateFilter);
    setStartTime24('');
    setDuration(2);
    setName('');
    setPhone('');
    setModal('booking');
  };

  const openEditModal = (b: Booking) => {
    setSelectedBooking(b);
    setFormSystem(b.system_id);
    setFormDate(b.booking_date);
    setName(b.customer_name);
    setPhone(b.phone_number);
    setDuration(Number(b.duration));

    // Reverse engineer 12h to 24h for the time input safely
    const parts = b.start_time.trim().split(/\s+/);
    const timeVal = parts[0];
    const modifierVal = parts[1];

    const timeParts = timeVal.split(':');
    let hVal = timeParts[0];
    const mVal = timeParts[1];

    if (modifierVal === 'PM' && hVal !== '12') hVal = String(Number(hVal) + 12);
    if (modifierVal === 'AM' && hVal === '12') hVal = '00';
    setStartTime24(`${hVal.padStart(2, '0')}:${mVal}`);

    setModal('booking');
  };

  // Smart Collision Logic for Modal
  let isOverlapping = false;
  let overlapWarning = '';

  if (startTime24 && duration > 0 && modal === 'booking') {
    const newStart = timeToMinutes(startTime24);
    const newEnd = newStart + (duration * 60);

    const conflict = bookings.find(b => {
      if (selectedBooking && b.id === selectedBooking.id) return false;
      if (b.system_id !== formSystem || b.booking_date !== formDate) return false;

      const bStart = timeToMinutes(b.start_time);
      const bEnd = bStart + (Number(b.duration) * 60);
      return newStart < bEnd && newEnd > bStart;
    });

    if (conflict) {
      isOverlapping = true;
      overlapWarning = `Overlaps with ${conflict.customer_name} (${conflict.start_time})`;
    }
  }

  const handleSaveBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing || isOverlapping || !startTime24 || !name || phone.length < 10) return;
    setIsProcessing(true);

    const time12 = format12Hour(startTime24);
    const payload = {
      customer_name: name.trim(),
      phone_number: phone.trim(),
      system_id: formSystem,
      booking_date: formDate,
      start_time: time12,
      duration: duration,
      status: 'Locked'
    };

    try {
      let savedRecord: Booking | null = null;
      if (selectedBooking) {
        const { data, error } = await supabase
          .from('gta_bookings')
          .update(payload)
          .eq('id', selectedBooking.id)
          .select()
          .single();
        if (error) throw error;
        savedRecord = (data || { ...selectedBooking, ...payload }) as Booking;
      } else {
        const { data, error } = await supabase
          .from('gta_bookings')
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        savedRecord = (data || { id: Date.now(), ...payload }) as Booking;
      }

      setModal(null);
      if (formDate !== dateFilter) {
        setDateFilter(formDate);
      } else {
        await fetchBookings();
      }

      if (savedRecord) {
        setSelectedBooking(savedRecord);
        setModal('whatsapp');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving booking.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this booking?")) return;
    setIsProcessing(true);
    await supabase.from('gta_bookings').delete().eq('id', id);
    await fetchBookings();
    setIsProcessing(false);
  };

  const handlePushToLive = async () => {
    if (!selectedBooking || isProcessing) return;
    setIsProcessing(true);

    const now = new Date();
    const istTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const entryTime = format12Hour(istTime);
    const today = getTodayString();
    const totalCost = getPrice(selectedBooking.duration, 0);

    try {
      // 1. Inject into live POS
      const { error: liveError } = await supabase.from('sales').insert([{
        customer: selectedBooking.customer_name,
        system: selectedBooking.system_id,
        duration: selectedBooking.duration,
        total: totalCost,
        status: 'Active',
        entry_time: entryTime,
        date: today,
        fnb_total: 0,
        method: 'Pending',
        fnb_items: ""
      }]);

      if (liveError) throw liveError;

      // 2. Mark as Pushed on dashboard
      await supabase.from('gta_bookings').update({ status: 'Pushed' }).eq('id', selectedBooking.id);

      setModal(null);
      await fetchBookings();
      alert(`Success! ${selectedBooking.customer_name} is now ACTIVE on the Live Floor.`);
    } catch (err) {
      console.error(err);
      alert("Error pushing to live floor.");
    } finally {
      setIsProcessing(false);
    }
  };

  const copyWhatsAppMessage = async (b: Booking) => {
    const freshBooking = bookings.find(item => item.id === b.id) || b;
    const text = buildWhatsAppText(freshBooking);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopiedId(freshBooking.id);
    setTimeout(() => {
      setCopiedId(prev => (prev === freshBooking.id ? null : prev));
    }, 2500);
  };

  const getCountdownInfo = (b: Booking) => {
    if (b.status === 'Pushed' || b.booking_date !== nowTick.dateStr) {
      return { label: null, isUrgent30Min: false };
    }

    const startMins = timeToMinutes(b.start_time);
    const diffMins = startMins - nowTick.currentMinutes;

    if (diffMins < 0) {
      return { label: 'Slot time reached', isUrgent30Min: false };
    }

    if (diffMins === 0) {
      return { label: 'Starting now', isUrgent30Min: true };
    }

    const isUrgent30Min = diffMins <= 30;
    if (diffMins < 60) {
      return { label: `In ${diffMins}m`, isUrgent30Min };
    }

    const hrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return {
      label: mins > 0 ? `In ${hrs}h ${mins}m` : `In ${hrs}h`,
      isUrgent30Min,
    };
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex bg-[#05070A] text-white items-center justify-center p-4" style={{ fontFamily: 'Lato, sans-serif' }}>
        <form onSubmit={handleLogin} className="bg-[#121824] p-8 rounded-3xl border border-[#1E293B] shadow-2xl w-full max-w-sm text-center">
          <div className="flex justify-center mb-6"><Lock size={40} className="text-[#00D0FF]" /></div>
          <h2 className="text-2xl font-black mb-1">GTA VI x Gamerarena</h2>
          <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-6">Staff Access Only</p>
          <input type="password" placeholder="Enter PIN" className="w-full bg-[#0B0E14] p-4 text-center rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none font-bold tracking-widest mb-4" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="w-full bg-[#00D0FF] text-black py-4 rounded-xl font-black hover:bg-white transition-all shadow-[0_0_15px_rgba(0,208,255,0.2)]">Unlock Dashboard</button>
        </form>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap');
        * { font-family: 'Lato', sans-serif; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1E293B; border-radius: 10px; }
      `}} />

      <div className="min-h-screen bg-[#05070A] text-white p-4 sm:p-6 lg:h-screen lg:flex lg:flex-col lg:overflow-hidden">

        {/* HEADER BAR */}
        <div className="flex flex-col gap-3 mb-6 shrink-0 bg-[#121824] p-4 rounded-2xl border border-[#1E293B]">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-black uppercase tracking-wide flex items-center gap-2">
                GTA VI x <span className="text-[#00D0FF]">Gamerarena</span>
              </h1>
              <p className="text-gray-500 text-[10px] font-bold tracking-widest uppercase mt-0.5">Pre-Booking Management • Upcoming 1h+ Slots (Till 12 AM)</p>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-3">
              <div className="flex items-center bg-[#0B0E14] px-3 py-2 rounded-xl border border-[#2D3748]">
                <Calendar size={14} className="text-[#00D0FF] mr-2" />
                <input type="date" className="bg-transparent outline-none text-sm font-bold [color-scheme:dark]" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
              </div>
              <button onClick={openCreateModal} className="bg-gradient-to-r from-pink-500 via-purple-500 to-[#00D0FF] text-white px-5 py-2.5 rounded-xl font-black text-sm hover:opacity-90 transition-all shadow-sm flex items-center gap-2 whitespace-nowrap">
                <Plus size={16} /> New Entry
              </button>
            </div>
          </div>

          {/* OPEN SLOTS STRIP (Upcoming Only, Till 12 AM Midnight, Minimum 1 Hour) */}
          <div className="pt-3 border-t border-[#1E293B] grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {SYSTEMS.map((sys) => {
              const openWindows = getAvailableSlots1HrPlus(
                bookings.filter((b) => b.system_id === sys),
                dateFilter,
                nowTick
              );
              return (
                <div key={sys} className="bg-[#0B0E14] border border-[#2D3748] rounded-xl px-3 py-2 flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-black text-[#00D0FF] bg-[#00D0FF]/10 px-2 py-0.5 rounded shrink-0">
                    {sys}
                  </span>
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {openWindows.length === 0 ? (
                      <span className="text-[11px] font-bold text-red-400">No 1h+ slots left</span>
                    ) : (
                      openWindows.map((win, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded whitespace-nowrap"
                        >
                          {minutesTo12Hour(win.start)} – {minutesTo12Hour(win.end)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* KANBAN BOARD */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:min-h-0 overflow-y-auto lg:overflow-hidden">
          {SYSTEMS.map(sys => {
            const sysBookings = bookings.filter(b => b.system_id === sys);
            return (
              <div key={sys} className="bg-[#121824] border border-[#1E293B] rounded-2xl flex flex-col overflow-hidden lg:h-full">
                {/* Column Header */}
                <div className="bg-[#0B0E14] p-4 border-b border-[#1E293B] shrink-0 flex justify-between items-center">
                  <h2 className="text-lg font-black text-white flex items-center gap-2">
                    <Monitor size={18} className="text-[#00D0FF]" /> {sys}
                  </h2>
                  <span className="text-xs font-bold text-gray-500 bg-[#1A2235] px-2 py-1 rounded">{sysBookings.length} Slots</span>
                </div>

                {/* Cards Area */}
                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-4">
                  {isFetching ? (
                    <p className="text-center text-xs text-gray-500 font-bold mt-10">Loading...</p>
                  ) : sysBookings.length === 0 ? (
                    <div className="text-center mt-10 border border-dashed border-[#2D3748] rounded-xl p-6">
                      <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">No Bookings</p>
                    </div>
                  ) : (
                    sysBookings.map(b => {
                      const countdown = getCountdownInfo(b);
                      const isCopied = copiedId === b.id;

                      return (
                        <div
                          key={b.id}
                          className={`border rounded-xl p-4 transition-all ${
                            b.status === 'Pushed'
                              ? 'bg-[#0B0E14] border-emerald-500/30 opacity-70'
                              : countdown.isUrgent30Min
                                ? 'bg-red-950/35 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                                : 'bg-[#0B0E14] border-[#2D3748] hover:border-[#00D0FF]/40'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="min-w-0 pr-2">
                              <p className="text-white font-black text-base truncate">{b.customer_name}</p>
                              <p className="text-gray-400 text-[10px] font-bold mt-0.5 tracking-wide">{b.phone_number}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={`text-xs font-black px-2 py-1 rounded ${
                                  b.status === 'Pushed'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : countdown.isUrgent30Min
                                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                      : 'bg-[#00D0FF]/10 text-[#00D0FF]'
                                }`}
                              >
                                {b.start_time}
                              </p>
                              <p className="text-gray-500 text-[10px] font-bold uppercase mt-1.5">{b.duration}h Block</p>
                            </div>
                          </div>

                          {countdown.label && b.status !== 'Pushed' && (
                            <div
                              className={`mb-3 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center justify-between ${
                                countdown.isUrgent30Min
                                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                                  : 'bg-[#121824] text-gray-300 border border-[#1E293B]'
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <Timer size={13} className={countdown.isUrgent30Min ? 'text-red-400 animate-pulse' : 'text-[#00D0FF]'} />
                                Next Slot
                              </span>
                              <span>{countdown.label}</span>
                            </div>
                          )}

                          {b.status === 'Pushed' ? (
                            <div className="mt-3 flex items-center justify-center gap-1.5 bg-emerald-500/10 text-emerald-500 py-2 rounded-lg text-xs font-black uppercase tracking-widest border border-emerald-500/20">
                              <Check size={14} /> Active on Live Floor
                            </div>
                          ) : (
                            <div className="mt-3 pt-3 border-t border-[#1E293B] flex gap-2">
                              <button onClick={() => { setSelectedBooking(b); setModal('push'); }} className="flex-1 bg-emerald-500 text-white py-2 rounded-lg text-xs font-black hover:bg-emerald-400 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                                <Rocket size={14} /> Push to Live
                              </button>
                              <button
                                onClick={() => copyWhatsAppMessage(b)}
                                className={`px-3 py-2 rounded-lg transition-all border flex items-center gap-1 text-xs font-bold ${
                                  isCopied
                                    ? 'bg-emerald-500 text-white border-emerald-400'
                                    : 'bg-[#1A2235] text-[#00D0FF] hover:bg-white hover:text-black border-[#2D3748]'
                                }`}
                                title="Copy WhatsApp Message"
                              >
                                {isCopied ? <Check size={14} /> : <MessageCircle size={14} />}
                                {isCopied && <span>Copied</span>}
                              </button>
                              <button onClick={() => openEditModal(b)} className="bg-[#1A2235] text-gray-400 px-3 py-2 rounded-lg hover:text-white transition-all border border-[#2D3748]" title="Edit">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => handleDelete(b.id)} className="bg-[#1A2235] text-gray-400 px-3 py-2 rounded-lg hover:text-red-400 hover:border-red-400 transition-all border border-[#2D3748]" title="Cancel">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* --- MODALS OVERLAY --- */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-[#1E293B] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">

            {/* Modal: WhatsApp Confirmation Popup on New/Edit Booking */}
            {modal === 'whatsapp' && selectedBooking && (
              <div className="p-6 text-center">
                <CheckCircle2 size={50} className="text-[#00D0FF] mx-auto mb-4" />
                <h2 className="text-xl font-black mb-2">Slot Locked Successfully!</h2>
                <p className="text-gray-400 text-xs mb-6">Click below to copy the updated WhatsApp confirmation message for <strong>{selectedBooking.customer_name}</strong>.</p>

                <div className="bg-[#0B0E14] border border-[#2D3748] rounded-xl p-4 text-left mb-6 space-y-1">
                  <p className="text-white text-xs font-bold">📅 Date: {selectedBooking.booking_date}</p>
                  <p className="text-[#00D0FF] text-xs font-black">⏰ Time: {selectedBooking.start_time} ({selectedBooking.duration}h)</p>
                  <p className="text-gray-400 text-xs font-bold">🎮 Console: {selectedBooking.system_id}</p>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    onClick={async () => {
                      await copyWhatsAppMessage(selectedBooking);
                      setModal(null);
                    }}
                    className="w-full bg-emerald-500 text-white py-3.5 rounded-xl font-black hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] text-sm"
                  >
                    <MessageCircle size={16} /> Copy WhatsApp Message
                  </button>
                  <button onClick={() => setModal(null)} className="w-full bg-[#1A2235] text-white py-3.5 rounded-xl font-bold border border-[#2D3748] hover:bg-gray-700 transition-all text-sm">
                    Close / Done
                  </button>
                </div>
              </div>
            )}

            {/* Modal: Push to Live Floor */}
            {modal === 'push' && selectedBooking && (
              <div className="p-6">
                <div className="flex justify-center mb-4"><Rocket size={40} className="text-emerald-400" /></div>
                <h2 className="text-xl font-black text-center mb-2">Send to Live Floor?</h2>
                <p className="text-gray-400 text-sm text-center mb-6">This will instantly start an Active session for <strong>{selectedBooking.customer_name}</strong> on <strong>{selectedBooking.system_id}</strong> in your main POS.</p>

                <div className="bg-[#0B0E14] border border-[#2D3748] rounded-xl p-4 mb-6">
                  <div className="flex justify-between text-sm mb-2"><span className="text-gray-500 font-bold">Duration</span><span className="text-white font-black">{selectedBooking.duration} Hours</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500 font-bold">Base Cost</span><span className="text-emerald-400 font-black">₹{getPrice(selectedBooking.duration, 0)}</span></div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setModal(null)} className="flex-1 bg-[#1A2235] text-white py-3.5 rounded-xl font-bold border border-[#2D3748] hover:bg-gray-700 transition-all text-sm">Cancel</button>
                  <button onClick={handlePushToLive} disabled={isProcessing} className="flex-1 bg-emerald-500 text-white py-3.5 rounded-xl font-black hover:bg-emerald-400 transition-all text-sm shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                    {isProcessing ? 'Pushing...' : 'Yes, Push to Live'}
                  </button>
                </div>
              </div>
            )}

            {/* Modal: Create / Edit Booking */}
            {modal === 'booking' && (
              <>
                <div className="bg-[#0B0E14] p-4 border-b border-[#1E293B] flex justify-between items-center">
                  <h2 className="text-lg font-black text-white">{selectedBooking ? 'Edit Booking' : 'New GTA Booking'}</h2>
                  <button onClick={() => setModal(null)} className="text-gray-400 hover:text-white transition-colors p-1"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Console</label>
                      <select className="w-full bg-[#0B0E14] p-3 text-sm rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white font-bold" value={formSystem} onChange={(e) => setFormSystem(e.target.value)}>
                        {SYSTEMS.map(sys => <option key={sys} value={sys}>{sys}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Date</label>
                      <input type="date" className="w-full bg-[#0B0E14] p-3 text-sm rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white [color-scheme:dark] font-bold" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Start Time</label>
                      <input type="time" className="w-full bg-[#0B0E14] p-3 text-sm rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white [color-scheme:dark] font-bold" value={startTime24} onChange={(e) => setStartTime24(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Duration</label>
                      <div className="flex justify-between items-center bg-[#0B0E14] mt-0.5 p-2 rounded-xl border border-[#2D3748]">
                        <button type="button" onClick={() => setDuration(Math.max(0.5, duration - 0.5))} className="p-1.5 hover:text-[#00D0FF] bg-[#1A2235] rounded-lg"><Minus size={14} /></button>
                        <span className="font-bold text-sm">{duration}h</span>
                        <button type="button" onClick={() => setDuration(duration + 0.5)} className="p-1.5 hover:text-[#00D0FF] bg-[#1A2235] rounded-lg"><Plus size={14} /></button>
                      </div>
                    </div>
                  </div>

                  {startTime24 && (
                    <div className={`p-3 rounded-xl border text-xs font-bold flex items-start gap-2 transition-all ${isOverlapping ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
                      {isOverlapping ? <><AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{overlapWarning}</span></> : <><ShieldCheck size={14} className="shrink-0 mt-0.5" /> <span>Time clear.</span></>}
                    </div>
                  )}

                  <div className="pt-2 border-t border-[#1E293B]">
                    <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Gamer Name</label>
                    <div className="flex items-center bg-[#0B0E14] rounded-xl border border-[#2D3748] px-3 focus-within:border-[#00D0FF]">
                      <User size={16} className="text-gray-500 shrink-0" />
                      <input type="text" className="w-full bg-transparent p-3 text-sm outline-none font-bold placeholder-gray-700" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Phone</label>
                    <div className="flex items-center bg-[#0B0E14] rounded-xl border border-[#2D3748] px-3 focus-within:border-[#00D0FF]">
                      <Phone size={16} className="text-gray-500 shrink-0" />
                      <input type="tel" maxLength={10} className="w-full bg-transparent p-3 text-sm outline-none font-bold placeholder-gray-700" placeholder="10-Digit Number" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button type="button" onClick={handleSaveBooking} disabled={isProcessing || isOverlapping || !startTime24 || !name || phone.length < 10} className="w-full bg-[#00D0FF] text-black py-4 rounded-xl font-black text-sm disabled:opacity-30 hover:bg-white transition-all shadow-[0_0_15px_rgba(0,208,255,0.2)]">
                      {isProcessing ? 'Saving...' : (selectedBooking ? 'Save Changes' : 'Lock Slot')}
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>
      )}

    </>
  );
}