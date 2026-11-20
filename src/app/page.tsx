'use client'

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  Calendar,
  Monitor,
  User,
  Phone,
  Plus,
  Minus,
  AlertTriangle,
  ShieldCheck,
  Check,
  Trash2,
  Edit2,
  Rocket,
  Lock,
  X,
  MessageCircle,
  CheckCircle2,
  Timer,
  Clock,
  RefreshCw,
  UserX,
  ExternalLink,
  ArrowLeftRight,
} from 'lucide-react';

const SYSTEMS = ['PS1', 'PS2', 'PS3'];
const OPENING_MINS = 600; // 10:00 AM
const CLOSING_MINS = 1440; // 12:00 AM (Midnight)
const MIN_SLOT_MINS = 60; // Ignore gaps under 1 hour

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
  id?: number;
  customer: string;
  system: string;
  status: string;
  entry_time?: string;
  duration?: number;
  total?: number;
  fnb_total?: number;
};

type TimeWindow = {
  start: number;
  end: number;
};

type StatusFilter = 'All' | 'Upcoming' | 'Pushed' | 'No-Show';

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

const minutesTo24Hour = (mins: number) => {
  const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h24.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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

// Calculates base cost for PS5: ₹150 per full hour + ₹100 for a 30-min extension
const getPrice = (dur: number, extra: number = 0) => {
  const numericDur = Number(dur) || 0;
  const full = Math.floor(numericDur);
  const half = numericDur % 1 !== 0 ? 1 : 0;
  return full * (150 + extra * 100) + half * (100 + extra * 100);
};

// Compute start & end minutes for an active live-floor POS sale
const getActiveSaleWindow = (sale: ActiveSale, fallbackStartMins: number): TimeWindow => {
  const start = sale.entry_time ? timeToMinutes(sale.entry_time) : fallbackStartMins;
  const durHours = Number(sale.duration) > 0 ? Number(sale.duration) : 1;
  // Ensure an active floor session blocks at least through the current time + 15m if overrun
  const rawEnd = start + durHours * 60;
  const effectiveEnd = Math.max(rawEnd, fallbackStartMins + 15);
  return {
    start,
    end: Math.min(CLOSING_MINS, effectiveEnd),
  };
};

const buildWhatsAppText = (b: Booking) => {
  const parts = b.booking_date.split('-');
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  const niceDate = `${d} ${dateObj.toLocaleString('en-US', { month: 'short' })} ${y}`;
  const totalBill = getPrice(Number(b.duration), 0);

  return `Dear *${b.customer_name}*,\n\nThank you for choosing Gamerarena! Your exclusive GTA VI slot has been successfully secured. Here are your booking details:\n\n📅 *Date:* ${niceDate}\n⏰ *Start Time:* ${b.start_time}\n⏳ *Duration:* ${b.duration} Hours\n🎮 *Console:* ${b.system_id}\n💰 *Total Amount:* ₹${totalBill}\n\n*⚠️ House Rules for Launch Week:*\n• *10-Minute Grace Period:* If you arrive more than 10 minutes late, your slot may be reassigned to the next waiting player.\n• *Hard Stops:* To ensure everyone gets their turn, sessions must end strictly on time if another gamer is scheduled after you.\n\nSee you at the arena! 🎮`;
};

const buildWhatsAppUrl = (b: Booking) => {
  const digits = (b.phone_number || '').replace(/\D/g, '');
  const formattedPhone = digits.length === 10 ? `91${digits}` : digits;
  const encodedText = encodeURIComponent(buildWhatsAppText(b));
  return formattedPhone
    ? `https://wa.me/${formattedPhone}?text=${encodedText}`
    : `https://wa.me/?text=${encodedText}`;
};

const getAvailableSlots1HrPlus = (
  sysBookings: Booking[],
  sysActiveSales: ActiveSale[],
  selectedDate: string,
  istNow: { dateStr: string; currentMinutes: number }
): TimeWindow[] => {
  if (!selectedDate || selectedDate < istNow.dateStr) return [];

  const roundedNow = Math.ceil(istNow.currentMinutes / 5) * 5;
  const startBoundary =
    selectedDate === istNow.dateStr
      ? Math.max(OPENING_MINS, roundedNow)
      : OPENING_MINS;

  if (startBoundary >= CLOSING_MINS) return [];

  const bookingBlocks = sysBookings
    .filter((b) => b.booking_date === selectedDate && b.status !== 'No-Show')
    .map((b) => {
      const start = timeToMinutes(b.start_time);
      const end = start + Number(b.duration) * 60;
      return { start, end };
    });

  // Also include any active walk-in / non-GTA sessions currently running on the Live Floor
  const liveSaleBlocks =
    selectedDate === istNow.dateStr
      ? sysActiveSales.map((s) => getActiveSaleWindow(s, istNow.currentMinutes))
      : [];

  const blocks = [...bookingBlocks, ...liveSaleBlocks]
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeSales, setActiveSales] = useState<ActiveSale[]>([]);
  const [loadedDate, setLoadedDate] = useState<string>('');
  const [isFetching, setIsFetching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [busyBookingId, setBusyBookingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => getISTParts());

  // Modal State
  const [modal, setModal] = useState<string | null>(null); // 'booking', 'push', 'whatsapp', null
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<string>('');

  // Form State (For Create/Edit)
  const [formSystem, setFormSystem] = useState('PS1');
  const [formDate, setFormDate] = useState(dateFilter);
  const [startTime24, setStartTime24] = useState('');
  const [duration, setDuration] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    document.title = 'Booking x Gamerarena';
  }, []);

  const fetchBookings = useCallback(async (targetDate: string, silent = false) => {
    if (!targetDate) return;
    if (!silent) setIsFetching(true);
    try {
      const [bookingsRes, salesRes] = await Promise.all([
        supabase.from('gta_bookings').select('*').eq('booking_date', targetDate),
        supabase
          .from('sales')
          .select('id, customer, system, status, entry_time, duration, total, fnb_total')
          .eq('date', targetDate)
          .eq('status', 'Active'),
      ]);

      if (bookingsRes.error) throw bookingsRes.error;

      const currentActiveSales = (salesRes.data || []) as ActiveSale[];
      const rawBookings = (bookingsRes.data || []) as Booking[];
      setActiveSales(currentActiveSales);

      const sorted = rawBookings.sort(
        (a: Booking, b: Booking) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
      );
      setBookings(sorted);
      setLoadedDate(targetDate);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      if (!silent) setIsFetching(false);
    }
  }, []);

  // Live clock tick & fallback sync every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(getISTParts());
      if (isAuthenticated && dateFilter) {
        fetchBookings(dateFilter, true);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [dateFilter, isAuthenticated, fetchBookings]);

  // Instant Supabase Realtime sync across staff devices & POS checkouts
  useEffect(() => {
    if (!isAuthenticated || !dateFilter) return;

    const channel = supabase
      .channel(`gta-dashboard-${dateFilter}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gta_bookings' },
        () => {
          fetchBookings(dateFilter, true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales' },
        () => {
          fetchBookings(dateFilter, true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dateFilter, isAuthenticated, fetchBookings]);

  // Fetch bookings immediately when date changes or after login
  useEffect(() => {
    if (isAuthenticated && dateFilter) {
      setBookings([]);
      setActiveSales([]);
      fetchBookings(dateFilter, false);
    }
  }, [dateFilter, isAuthenticated, fetchBookings]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'gta2026') {
      setIsAuthenticated(true);
    } else {
      alert('Incorrect PIN');
    }
  };

  const openCreateModal = (presetSystem?: string, presetStartMins?: number) => {
    setSelectedBooking(null);
    setSwapTargetId('');
    setFormSystem(presetSystem || 'PS1');
    setFormDate(dateFilter);
    setStartTime24(presetStartMins !== undefined ? minutesTo24Hour(presetStartMins) : '');
    setDuration(2);
    setName('');
    setPhone('');
    setModal('booking');
  };

  const openEditModal = (b: Booking) => {
    setSelectedBooking(b);
    setSwapTargetId('');
    setFormSystem(b.system_id);
    setFormDate(b.booking_date);
    setName(b.customer_name);
    setPhone(b.phone_number);
    setDuration(Math.max(1, Number(b.duration)));

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

  // All valid bookings for the selected date (never reduced when a pushed session ends in POS)
  const activeDateBookings = bookings.filter((b) => b.booking_date === dateFilter);
  const validBookedSlots = activeDateBookings.filter((b) => b.status !== 'No-Show');
  const totalBookedHours = validBookedSlots.reduce((sum, b) => sum + Number(b.duration || 0), 0);

  // Kanban card list hides completed Pushed sessions once they are no longer Active in POS
  const kanbanBookings = activeDateBookings.filter((b) => {
    if (b.status !== 'Pushed') return true;
    return activeSales.some(
      (s) =>
        s.system === b.system_id &&
        s.customer.trim().toLowerCase() === b.customer_name.trim().toLowerCase()
    );
  });

  // Smart Collision Logic for Modal (checks both GTA bookings AND active Live Floor walk-in sessions)
  let isOverlapping = false;
  let overlapWarning = '';

  if (startTime24 && duration >= 1 && modal === 'booking') {
    const newStart = timeToMinutes(startTime24);
    const newEnd = newStart + duration * 60;

    const bookingConflict = kanbanBookings.find((b) => {
      if (b.status === 'No-Show') return false;
      if (selectedBooking && b.id === selectedBooking.id) return false;
      if (b.system_id !== formSystem || b.booking_date !== formDate) return false;

      const bStart = timeToMinutes(b.start_time);
      const bEnd = bStart + Number(b.duration) * 60;
      return newStart < bEnd && newEnd > bStart;
    });

    if (bookingConflict) {
      isOverlapping = true;
      overlapWarning = `Overlaps with ${bookingConflict.customer_name} (${bookingConflict.start_time} – ${minutesTo12Hour(timeToMinutes(bookingConflict.start_time) + Number(bookingConflict.duration) * 60)})`;
    } else if (formDate === nowTick.dateStr) {
      // Check against active walk-in / non-GTA sessions on the Live Floor
      const liveFloorConflict = activeSales.find((s) => {
        if (s.system !== formSystem) return false;
        // Skip if this sale belongs to the exact booking we are currently editing
        if (
          selectedBooking &&
          selectedBooking.status === 'Pushed' &&
          s.customer.trim().toLowerCase() === selectedBooking.customer_name.trim().toLowerCase()
        ) {
          return false;
        }
        const win = getActiveSaleWindow(s, nowTick.currentMinutes);
        return newStart < win.end && newEnd > win.start;
      });

      if (liveFloorConflict) {
        const win = getActiveSaleWindow(liveFloorConflict, nowTick.currentMinutes);
        isOverlapping = true;
        overlapWarning = `${formSystem} busy on Live Floor (${liveFloorConflict.customer} until ${minutesTo12Hour(win.end)})`;
      }
    }
  }

  // Helper to sync a Pushed booking's system/duration changes to the live POS `sales` table
  const syncLiveSaleRecord = async (
    oldBooking: Booking,
    updates: { system?: string; duration?: number }
  ) => {
    const { data: matchingSales, error: salesFetchError } = await supabase
      .from('sales')
      .select('id, customer, system, duration, fnb_total')
      .eq('date', oldBooking.booking_date)
      .eq('system', oldBooking.system_id)
      .eq('status', 'Active');

    if (salesFetchError || !matchingSales || matchingSales.length === 0) return;

    const matchedSale =
      matchingSales.find(
        (s) => s.customer.trim().toLowerCase() === oldBooking.customer_name.trim().toLowerCase()
      ) || matchingSales[0];

    const finalDuration = updates.duration !== undefined ? updates.duration : Number(oldBooking.duration);
    const fnbTotal = Number(matchedSale.fnb_total || 0);
    const updatedTotal = getPrice(finalDuration, 0) + fnbTotal;

    const salePayload: { system?: string; duration?: number; total?: number } = {};
    if (updates.system) salePayload.system = updates.system;
    if (updates.duration !== undefined) {
      salePayload.duration = finalDuration;
      salePayload.total = updatedTotal;
    }

    const { error: salesUpdateError } = await supabase
      .from('sales')
      .update(salePayload)
      .eq('id', matchedSale.id);

    if (salesUpdateError) throw salesUpdateError;
  };

  // Check if moving booking `b` to `targetSys` (at its same start_time & duration) has any collision
  const getMoveConflict = (b: Booking, targetSys: string) => {
    const start = timeToMinutes(b.start_time);
    const end = start + Number(b.duration) * 60;

    if (b.booking_date === nowTick.dateStr) {
      const liveFloorCollision = activeSales.find((s) => {
        if (s.system !== targetSys) return false;
        if (b.status === 'Pushed') return true;
        const win = getActiveSaleWindow(s, nowTick.currentMinutes);
        return start < win.end && end > win.start;
      });
      if (liveFloorCollision) {
        const win = getActiveSaleWindow(liveFloorCollision, nowTick.currentMinutes);
        return `${liveFloorCollision.customer} active on ${targetSys} until ${minutesTo12Hour(win.end)}`;
      }
    }

    const conflict = kanbanBookings.find((other) => {
      if (other.id === b.id || other.status === 'No-Show') return false;
      if (other.system_id !== targetSys || other.booking_date !== b.booking_date) return false;
      const oStart = timeToMinutes(other.start_time);
      const oEnd = oStart + Number(other.duration) * 60;
      return start < oEnd && end > oStart;
    });

    return conflict ? `${conflict.customer_name} (${conflict.start_time})` : null;
  };

  // One-Tap Move to another PS5 console (works for both Upcoming and Active on Live Floor)
  const handleMoveSystem = async (b: Booking, targetSys: string) => {
    if (targetSys === b.system_id || busyBookingId !== null) return;
    const conflictText = getMoveConflict(b, targetSys);
    if (conflictText) {
      alert(`Cannot move to ${targetSys}: blocked by ${conflictText}.`);
      return;
    }

    setBusyBookingId(b.id);
    try {
      const { error } = await supabase
        .from('gta_bookings')
        .update({ system_id: targetSys })
        .eq('id', b.id);

      if (error) throw error;

      if (b.status === 'Pushed') {
        await syncLiveSaleRecord(b, { system: targetSys });
      }

      await fetchBookings(dateFilter, true);
    } catch (err) {
      console.error('Move system error:', err);
      alert(`Error moving ${b.customer_name} to ${targetSys}.`);
    } finally {
      setBusyBookingId(null);
    }
  };

  // Atomically swap two bookings' console & start time
  const handleSwapBookings = async () => {
    if (!selectedBooking || !swapTargetId || isProcessing) return;
    const targetBooking = kanbanBookings.find((b) => String(b.id) === swapTargetId);
    if (!targetBooking) return;

    setIsProcessing(true);
    try {
      const firstUpdates = {
        system_id: targetBooking.system_id,
        start_time: targetBooking.start_time,
        booking_date: targetBooking.booking_date,
      };
      const secondUpdates = {
        system_id: selectedBooking.system_id,
        start_time: selectedBooking.start_time,
        booking_date: selectedBooking.booking_date,
      };

      const [res1, res2] = await Promise.all([
        supabase.from('gta_bookings').update(firstUpdates).eq('id', selectedBooking.id),
        supabase.from('gta_bookings').update(secondUpdates).eq('id', targetBooking.id),
      ]);

      if (res1.error) throw res1.error;
      if (res2.error) throw res2.error;

      if (selectedBooking.status === 'Pushed') {
        await syncLiveSaleRecord(selectedBooking, { system: firstUpdates.system_id });
      }
      if (targetBooking.status === 'Pushed') {
        await syncLiveSaleRecord(targetBooking, { system: secondUpdates.system_id });
      }

      setModal(null);
      setSwapTargetId('');
      await fetchBookings(dateFilter);
      alert(
        `Swapped! ${selectedBooking.customer_name} is now on ${firstUpdates.system_id} at ${firstUpdates.start_time}, and ${targetBooking.customer_name} is on ${secondUpdates.system_id} at ${secondUpdates.start_time}.`
      );
    } catch (err) {
      console.error('Swap error:', err);
      alert('Error swapping slots.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing || isOverlapping || !startTime24 || duration < 1 || !name.trim() || phone.trim().length < 10) return;
    setIsProcessing(true);

    const time12 = format12Hour(startTime24);
    const payload = {
      customer_name: name.trim(),
      phone_number: phone.trim(),
      system_id: formSystem,
      booking_date: formDate,
      start_time: time12,
      duration: duration,
      status: selectedBooking?.status === 'Pushed' ? 'Pushed' : 'Locked',
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

        if (selectedBooking.status === 'Pushed') {
          await syncLiveSaleRecord(selectedBooking, {
            system: formSystem,
            duration: duration,
          });
        }
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
        await fetchBookings(dateFilter);
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

  // Calculate maximum buffer minutes available right after a booking on the same console
  const getAvailableBufferMins = (b: Booking, sysBookings: Booking[]) => {
    const endMins = timeToMinutes(b.start_time) + Number(b.duration) * 60;
    if (endMins >= CLOSING_MINS) return 0;

    const upcomingOnSameSys = sysBookings
      .filter(
        (other) =>
          other.id !== b.id &&
          other.status !== 'No-Show' &&
          timeToMinutes(other.start_time) >= endMins
      )
      .sort((a, c) => timeToMinutes(a.start_time) - timeToMinutes(c.start_time));

    const nextLimit =
      upcomingOnSameSys.length > 0
        ? Math.min(CLOSING_MINS, timeToMinutes(upcomingOnSameSys[0].start_time))
        : CLOSING_MINS;

    return Math.max(0, nextLimit - endMins);
  };

  // Extend an Active on Live Floor session (updates both gta_bookings and live POS sales table)
  const handleExtendActiveSession = async (b: Booking, extraHours: number, availableBufferMins: number) => {
    const extraMins = extraHours * 60;
    if (extraMins > availableBufferMins || busyBookingId !== null) return;

    const newDuration = Number(b.duration) + extraHours;
    const newEndFormatted = minutesTo12Hour(timeToMinutes(b.start_time) + newDuration * 60);

    setBusyBookingId(b.id);
    try {
      const { error: bookingError } = await supabase
        .from('gta_bookings')
        .update({ duration: newDuration })
        .eq('id', b.id);

      if (bookingError) throw bookingError;

      await syncLiveSaleRecord(b, { duration: newDuration });

      await fetchBookings(dateFilter, true);
      alert(`Extended ${b.customer_name} by +${extraHours}h (Now ends at ${newEndFormatted}, Total: ₹${getPrice(newDuration, 0)}).`);
    } catch (err) {
      console.error('Extend error:', err);
      alert('Error extending live session.');
    } finally {
      setBusyBookingId(null);
    }
  };

  const handleMarkNoShow = async (b: Booking) => {
    if (!window.confirm(`Mark ${b.customer_name} as No-Show? This will release their ${b.start_time} slot on ${b.system_id}.`)) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('gta_bookings')
        .update({ status: 'No-Show' })
        .eq('id', b.id);
      if (error) throw error;
      await fetchBookings(dateFilter);
    } catch (err) {
      console.error(err);
      alert('Error updating status.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreBooking = async (b: Booking) => {
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('gta_bookings')
        .update({ status: 'Locked' })
        .eq('id', b.id);
      if (error) throw error;
      await fetchBookings(dateFilter);
    } catch (err) {
      console.error(err);
      alert('Error restoring booking.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this booking?')) return;
    setIsProcessing(true);
    await supabase.from('gta_bookings').delete().eq('id', id);
    await fetchBookings(dateFilter);
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
      const { data: existingActive } = await supabase
        .from('sales')
        .select('customer, system')
        .eq('date', today)
        .eq('system', selectedBooking.system_id)
        .eq('status', 'Active');

      if (existingActive && existingActive.length > 0) {
        const runningGamer = existingActive[0].customer;
        const proceed = window.confirm(
          `⚠️ ${selectedBooking.system_id} already has an Active session (${runningGamer}) on the Live Floor.\n\nDo you still want to push ${selectedBooking.customer_name} to ${selectedBooking.system_id}?`
        );
        if (!proceed) {
          setIsProcessing(false);
          return;
        }
      }

      const { error: liveError } = await supabase.from('sales').insert([
        {
          customer: selectedBooking.customer_name,
          system: selectedBooking.system_id,
          duration: selectedBooking.duration,
          total: totalCost,
          status: 'Active',
          entry_time: entryTime,
          date: today,
          fnb_total: 0,
          method: 'Pending',
          fnb_items: '',
        },
      ]);

      if (liveError) throw liveError;

      await supabase.from('gta_bookings').update({ status: 'Pushed' }).eq('id', selectedBooking.id);

      setModal(null);
      await fetchBookings(dateFilter);
      alert(`Success! ${selectedBooking.customer_name} is now ACTIVE on the Live Floor.`);
    } catch (err) {
      console.error(err);
      alert('Error pushing to live floor.');
    } finally {
      setIsProcessing(false);
    }
  };

  const copyWhatsAppMessage = async (b: Booking) => {
    const freshBooking = bookings.find((item) => item.id === b.id) || b;
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
      setCopiedId((prev) => (prev === freshBooking.id ? null : prev));
    }, 2500);
  };

  const getCountdownInfo = (b: Booking) => {
    if (b.status === 'Pushed' || b.status === 'No-Show' || b.booking_date !== nowTick.dateStr) {
      return { label: null, isUrgent30Min: false };
    }

    const startMins = timeToMinutes(b.start_time);
    const diffMins = startMins - nowTick.currentMinutes;

    if (diffMins < 0) {
      const lateMins = Math.abs(diffMins);
      return {
        label: lateMins > 10 ? `Late by ${lateMins}m (>10m grace)` : `Started ${lateMins}m ago`,
        isUrgent30Min: lateMins > 10,
      };
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

  const modalOpenWindows =
    modal === 'booking' && formDate
      ? getAvailableSlots1HrPlus(
          kanbanBookings.filter(
            (b) =>
              b.system_id === formSystem &&
              b.booking_date === formDate &&
              (!selectedBooking || b.id !== selectedBooking.id)
          ),
          formDate === dateFilter
            ? activeSales.filter(
                (s) =>
                  s.system === formSystem &&
                  !(
                    selectedBooking &&
                    selectedBooking.status === 'Pushed' &&
                    s.customer.trim().toLowerCase() === selectedBooking.customer_name.trim().toLowerCase()
                  )
              )
            : [],
          formDate,
          nowTick
        )
      : [];

  const swappableBookings =
    modal === 'booking' && selectedBooking
      ? kanbanBookings.filter(
          (b) => b.id !== selectedBooking.id && b.status !== 'No-Show'
        )
      : [];

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex bg-[#05070A] text-white items-center justify-center p-4" style={{ fontFamily: 'Lato, sans-serif' }}>
        <form onSubmit={handleLogin} className="bg-[#121824] p-8 rounded-3xl border border-[#1E293B] shadow-2xl w-full max-w-sm text-center">
          <div className="flex justify-center mb-6"><Lock size={40} className="text-[#00D0FF]" /></div>
          <h2 className="text-2xl font-black mb-1">Booking x Gamerarena</h2>
          <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-6">Staff Access Only</p>
          <input type="password" placeholder="Enter PIN" className="w-full bg-[#0B0E14] p-4 text-center rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none font-bold tracking-widest mb-4" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="w-full bg-[#00D0FF] text-black py-4 rounded-xl font-black hover:bg-white transition-all shadow-[0_0_15px_rgba(0,208,255,0.2)]">Unlock Dashboard</button>
        </form>
      </div>
    );
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap');
        * { font-family: 'Lato', sans-serif; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1E293B; border-radius: 10px; }
      `,
        }}
      />

      <div className="min-h-screen bg-[#05070A] text-white p-4 sm:p-6 lg:h-screen lg:flex lg:flex-col lg:overflow-hidden">
        {/* HEADER BAR */}
        <div className="flex flex-col gap-3 mb-6 shrink-0 bg-[#121824] p-4 rounded-2xl border border-[#1E293B]">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h1 className="text-2xl font-black uppercase tracking-wide flex items-center gap-2">
                  Booking x <span className="text-[#00D0FF]">Gamerarena</span>
                </h1>
                <p className="text-gray-500 text-[10px] font-bold tracking-widest uppercase mt-0.5">
                  Pre-Booking Management • Live Floor Aware (10 AM – 12 AM)
                </p>
              </div>

              <div className="bg-[#0B0E14] border border-[#00D0FF]/30 px-3.5 py-2 rounded-xl flex items-center gap-2">
                <Clock size={15} className="text-[#00D0FF]" />
                <div>
                  <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider leading-none">Total Booked</p>
                  <p className="text-sm font-black text-white mt-0.5 leading-none">{totalBookedHours} hrs</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap w-full lg:w-auto items-center gap-2.5">
              {/* Status Filter Pills */}
              <div className="flex items-center bg-[#0B0E14] p-1 rounded-xl border border-[#2D3748]">
                {(['All', 'Upcoming', 'Pushed', 'No-Show'] as StatusFilter[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                      statusFilter === tab
                        ? 'bg-[#00D0FF] text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {tab === 'Pushed' ? 'Live' : tab}
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-[#0B0E14] px-3 py-2 rounded-xl border border-[#2D3748]">
                <Calendar size={14} className="text-[#00D0FF] mr-2" />
                <input
                  type="date"
                  className="bg-transparent outline-none text-sm font-bold [color-scheme:dark]"
                  value={dateFilter}
                  onChange={(e) => {
                    if (e.target.value) setDateFilter(e.target.value);
                  }}
                />
              </div>

              <button
                onClick={() => fetchBookings(dateFilter, false)}
                disabled={isFetching}
                className="bg-[#0B0E14] text-gray-300 hover:text-[#00D0FF] p-2.5 rounded-xl border border-[#2D3748] transition-all"
                title="Refresh Bookings & POS Sync"
              >
                <RefreshCw size={16} className={isFetching ? 'animate-spin text-[#00D0FF]' : ''} />
              </button>

              <button
                onClick={() => openCreateModal()}
                className="bg-gradient-to-r from-pink-500 via-purple-500 to-[#00D0FF] text-white px-5 py-2.5 rounded-xl font-black text-sm hover:opacity-90 transition-all shadow-sm flex items-center gap-2 whitespace-nowrap"
              >
                <Plus size={16} /> New Entry
              </button>
            </div>
          </div>

          {/* OPEN SLOTS STRIP (Accounts for both GTA Bookings AND Live Floor POS Sessions) */}
          <div className="pt-3 border-t border-[#1E293B] grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {SYSTEMS.map((sys) => {
              const isDateSynced = loadedDate === dateFilter && !isFetching;
              const sysLiveSales = activeSales.filter((s) => s.system === sys);
              const openWindows = isDateSynced
                ? getAvailableSlots1HrPlus(
                    kanbanBookings.filter((b) => b.system_id === sys),
                    sysLiveSales,
                    dateFilter,
                    nowTick
                  )
                : [];
              const liveFloorSale = sysLiveSales[0];

              return (
                <div key={sys} className="bg-[#0B0E14] border border-[#2D3748] rounded-xl px-3 py-2 flex flex-col justify-center gap-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-black text-[#00D0FF] bg-[#00D0FF]/10 px-2 py-0.5 rounded">
                        {sys}
                      </span>
                      {liveFloorSale ? (
                        <span className="text-[10px] font-black text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          Live Floor: {liveFloorSale.customer} (till {minutesTo12Hour(getActiveSaleWindow(liveFloorSale, nowTick.currentMinutes).end)})
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-gray-500">Floor Free</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {!isDateSynced ? (
                      <span className="text-[11px] font-bold text-gray-500">Checking slots...</span>
                    ) : openWindows.length === 0 ? (
                      <span className="text-[11px] font-bold text-red-400">
                        {liveFloorSale ? `Busy on Live Floor • No 1h+ slot left` : 'No 1h+ slots left'}
                      </span>
                    ) : (
                      openWindows.map((win, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => openCreateModal(sys, win.start)}
                          className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 px-2 py-0.5 rounded whitespace-nowrap transition-all"
                          title={`Click to book ${sys} at ${minutesTo12Hour(win.start)}`}
                        >
                          {minutesTo12Hour(win.start)} – {minutesTo12Hour(win.end)}
                        </button>
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
          {SYSTEMS.map((sys) => {
            const allSysBooked = validBookedSlots.filter((b) => b.system_id === sys);
            const sysHours = allSysBooked.reduce((sum, b) => sum + Number(b.duration || 0), 0);

            const visibleSysBookings = kanbanBookings.filter((b) => b.system_id === sys);
            const activeSysBookings = visibleSysBookings.filter((b) => b.status !== 'No-Show');

            // Detect non-GTA / walk-in session running directly on the Live Floor for this console
            const nonGtaLiveSession =
              dateFilter === nowTick.dateStr
                ? activeSales.find(
                    (s) =>
                      s.system === sys &&
                      !visibleSysBookings.some(
                        (b) =>
                          b.status === 'Pushed' &&
                          b.customer_name.trim().toLowerCase() === s.customer.trim().toLowerCase()
                      )
                  )
                : undefined;

            const filteredSysBookings = visibleSysBookings.filter((b) => {
              if (statusFilter === 'All') return true;
              if (statusFilter === 'Upcoming') return b.status === 'Locked';
              if (statusFilter === 'Pushed') return b.status === 'Pushed';
              if (statusFilter === 'No-Show') return b.status === 'No-Show';
              return true;
            });

            return (
              <div key={sys} className="bg-[#121824] border border-[#1E293B] rounded-2xl flex flex-col overflow-hidden lg:h-full">
                {/* Column Header */}
                <div className="bg-[#0B0E14] p-4 border-b border-[#1E293B] shrink-0 flex justify-between items-center">
                  <h2 className="text-lg font-black text-white flex items-center gap-2">
                    <Monitor size={18} className="text-[#00D0FF]" /> {sys}
                  </h2>
                  <span className="text-xs font-bold text-gray-400 bg-[#1A2235] px-2.5 py-1 rounded">
                    {allSysBooked.length} Slots • {sysHours}h
                  </span>
                </div>

                {/* Cards Area */}
                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-4">
                  {/* Live Floor Walk-in / Non-GTA Occupied Banner */}
                  {nonGtaLiveSession && (
                    <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          Live Floor Occupied (Walk-In / Other)
                        </p>
                        <p className="text-xs font-black text-white truncate mt-0.5">
                          {nonGtaLiveSession.customer}
                        </p>
                      </div>
                      <span className="text-[11px] font-black text-amber-300 bg-amber-500/15 px-2.5 py-1 rounded-lg shrink-0">
                        Busy till {minutesTo12Hour(getActiveSaleWindow(nonGtaLiveSession, nowTick.currentMinutes).end)}
                      </span>
                    </div>
                  )}

                  {isFetching ? (
                    <p className="text-center text-xs text-gray-500 font-bold mt-10">Loading...</p>
                  ) : filteredSysBookings.length === 0 ? (
                    <div className="text-center mt-10 border border-dashed border-[#2D3748] rounded-xl p-6">
                      <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">No GTA Bookings</p>
                    </div>
                  ) : (
                    filteredSysBookings.map((b) => {
                      const countdown = getCountdownInfo(b);
                      const isCopied = copiedId === b.id;
                      const startMins = timeToMinutes(b.start_time);
                      const endMins = startMins + Number(b.duration) * 60;
                      const endTimeFormatted = minutesTo12Hour(endMins);
                      const bookingTotal = getPrice(Number(b.duration), 0);
                      const isBusyThis = busyBookingId === b.id;

                      const bufferMins =
                        b.status !== 'No-Show' ? getAvailableBufferMins(b, activeSysBookings) : 0;
                      const canExtend30m = bufferMins >= 30;
                      const canExtend1h = bufferMins >= 60;

                      const hasBackToBackNext =
                        b.status !== 'No-Show' &&
                        activeSysBookings.some(
                          (other) => other.id !== b.id && timeToMinutes(other.start_time) === endMins
                        );

                      const otherConsoles = SYSTEMS.filter((s) => s !== b.system_id);

                      return (
                        <div
                          key={b.id}
                          className={`border rounded-xl p-4 transition-all ${
                            b.status === 'No-Show'
                              ? 'bg-[#0B0E14]/60 border-gray-800 opacity-55'
                              : b.status === 'Pushed'
                                ? 'bg-[#0B0E14] border-emerald-500/40'
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
                                  b.status === 'No-Show'
                                    ? 'bg-gray-800 text-gray-400'
                                    : b.status === 'Pushed'
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                      : countdown.isUrgent30Min
                                        ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                        : 'bg-[#00D0FF]/10 text-[#00D0FF]'
                                }`}
                              >
                                {b.start_time} – {endTimeFormatted}
                              </p>
                              <p className="text-gray-400 text-[10px] font-bold uppercase mt-1.5">
                                {b.duration}h • <span className="text-emerald-400 font-black">₹{bookingTotal}</span>
                              </p>
                            </div>
                          </div>

                          {hasBackToBackNext && (
                            <div className="mb-2.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
                              <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                              Hard Stop at {endTimeFormatted} (Next Slot Back-to-Back)
                            </div>
                          )}

                          {countdown.label && b.status === 'Locked' && (
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

                          {/* Quick Console Shift Bar */}
                          {b.status !== 'No-Show' && (
                            <div className="mb-2.5 flex items-center gap-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1 mr-1">
                                <ArrowLeftRight size={11} className="text-[#00D0FF]" /> Move:
                              </span>
                              {otherConsoles.map((targetSys) => {
                                const moveConflict = getMoveConflict(b, targetSys);
                                return (
                                  <button
                                    key={targetSys}
                                    type="button"
                                    disabled={Boolean(moveConflict) || isBusyThis}
                                    onClick={() => handleMoveSystem(b, targetSys)}
                                    className="px-2 py-1 rounded-md text-[10px] font-black bg-[#121824] text-gray-300 hover:bg-[#00D0FF] hover:text-black disabled:opacity-30 disabled:pointer-events-none border border-[#2D3748] transition-all"
                                    title={
                                      moveConflict
                                        ? `${targetSys} busy: ${moveConflict}`
                                        : `Switch ${b.customer_name} to ${targetSys}`
                                    }
                                  >
                                    → {targetSys}
                                  </button>
                                );
                              })}
                              {b.status === 'Pushed' && (
                                <button
                                  type="button"
                                  onClick={() => openEditModal(b)}
                                  className="ml-auto px-2 py-1 rounded-md text-[10px] font-black bg-[#121824] text-gray-400 hover:text-white border border-[#2D3748] transition-all"
                                  title="Edit or Swap Live Session"
                                >
                                  Swap / Edit
                                </button>
                              )}
                            </div>
                          )}

                          {b.status === 'Pushed' ? (
                            <div className="mt-2 pt-2.5 border-t border-[#1E293B] space-y-2.5">
                              <div className="flex items-center justify-between gap-2 bg-emerald-500/10 text-emerald-400 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider border border-emerald-500/20">
                                <span className="flex items-center gap-1.5">
                                  <Check size={14} /> Active on Live Floor
                                </span>
                                <span className="text-[10px] font-bold text-emerald-300/80">
                                  {bufferMins > 0 ? `${bufferMins}m buffer` : 'No buffer'}
                                </span>
                              </div>

                              {/* Buffer-aware Extension Controls for Live Sessions */}
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!canExtend30m || isBusyThis}
                                  onClick={() => handleExtendActiveSession(b, 0.5, bufferMins)}
                                  className="flex-1 bg-[#1A2235] text-[#00D0FF] hover:bg-[#00D0FF] hover:text-black disabled:opacity-30 disabled:pointer-events-none py-2 rounded-lg text-xs font-black border border-[#2D3748] transition-all"
                                  title={
                                    canExtend30m
                                      ? `Extend by 30 mins (until ${minutesTo12Hour(endMins + 30)})`
                                      : 'Less than 30m buffer before next slot'
                                  }
                                >
                                  {isBusyThis ? 'Updating...' : '+30m Extend (+₹100)'}
                                </button>
                                <button
                                  type="button"
                                  disabled={!canExtend1h || isBusyThis}
                                  onClick={() => handleExtendActiveSession(b, 1, bufferMins)}
                                  className="flex-1 bg-[#1A2235] text-emerald-400 hover:bg-emerald-500 hover:text-white disabled:opacity-30 disabled:pointer-events-none py-2 rounded-lg text-xs font-black border border-[#2D3748] transition-all"
                                  title={
                                    canExtend1h
                                      ? `Extend by 1 hour (until ${minutesTo12Hour(endMins + 60)})`
                                      : 'Less than 1h buffer before next slot'
                                  }
                                >
                                  {isBusyThis ? 'Updating...' : '+1h Extend (+₹150)'}
                                </button>
                              </div>
                            </div>
                          ) : b.status === 'No-Show' ? (
                            <div className="mt-3 pt-3 border-t border-[#1E293B] flex items-center justify-between gap-2">
                              <span className="text-[11px] font-black uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                                <UserX size={13} className="text-red-400" /> Marked No-Show
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleRestoreBooking(b)}
                                  className="bg-[#1A2235] text-[#00D0FF] px-3 py-1.5 rounded-lg text-xs font-black hover:bg-white hover:text-black transition-all border border-[#2D3748]"
                                >
                                  Restore
                                </button>
                                <button
                                  onClick={() => handleDelete(b.id)}
                                  className="bg-[#1A2235] text-gray-400 px-2.5 py-1.5 rounded-lg hover:text-red-400 hover:border-red-400 transition-all border border-[#2D3748]"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 pt-2.5 border-t border-[#1E293B] flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setSelectedBooking(b);
                                  setModal('push');
                                }}
                                className="flex-1 min-w-[115px] bg-emerald-500 text-white py-2 rounded-lg text-xs font-black hover:bg-emerald-400 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                              >
                                <Rocket size={14} /> Push to Live
                              </button>
                              <a
                                href={buildWhatsAppUrl(b)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-[#1A2235] text-emerald-400 px-2.5 py-2 rounded-lg hover:bg-emerald-500 hover:text-white transition-all border border-[#2D3748] flex items-center justify-center"
                                title="Send Directly on WhatsApp"
                              >
                                <ExternalLink size={14} />
                              </a>
                              <button
                                onClick={() => copyWhatsAppMessage(b)}
                                className={`px-2.5 py-2 rounded-lg transition-all border flex items-center gap-1 text-xs font-bold ${
                                  isCopied
                                    ? 'bg-emerald-500 text-white border-emerald-400'
                                    : 'bg-[#1A2235] text-[#00D0FF] hover:bg-white hover:text-black border-[#2D3748]'
                                }`}
                                title="Copy WhatsApp Message"
                              >
                                {isCopied ? <Check size={14} /> : <MessageCircle size={14} />}
                                {isCopied && <span>Copied</span>}
                              </button>
                              <button
                                onClick={() => openEditModal(b)}
                                className="bg-[#1A2235] text-gray-400 px-2.5 py-2 rounded-lg hover:text-white transition-all border border-[#2D3748]"
                                title="Edit or Swap Slot"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleMarkNoShow(b)}
                                className="bg-[#1A2235] text-gray-400 px-2.5 py-2 rounded-lg hover:text-amber-400 hover:border-amber-400 transition-all border border-[#2D3748]"
                                title="Mark No-Show (Release Slot)"
                              >
                                <UserX size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(b.id)}
                                className="bg-[#1A2235] text-gray-400 px-2.5 py-2 rounded-lg hover:text-red-400 hover:border-red-400 transition-all border border-[#2D3748]"
                                title="Delete"
                              >
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
                <p className="text-gray-400 text-xs mb-6">
                  Send or copy the updated WhatsApp confirmation for <strong>{selectedBooking.customer_name}</strong>.
                </p>

                <div className="bg-[#0B0E14] border border-[#2D3748] rounded-xl p-4 text-left mb-6 space-y-1">
                  <p className="text-white text-xs font-bold">📅 Date: {selectedBooking.booking_date}</p>
                  <p className="text-[#00D0FF] text-xs font-black">
                    ⏰ Time: {selectedBooking.start_time} – {minutesTo12Hour(timeToMinutes(selectedBooking.start_time) + Number(selectedBooking.duration) * 60)} ({selectedBooking.duration}h)
                  </p>
                  <p className="text-gray-400 text-xs font-bold">🎮 Console: {selectedBooking.system_id}</p>
                  <p className="text-emerald-400 text-xs font-black">
                    💰 Total Amount: ₹{getPrice(Number(selectedBooking.duration), 0)}
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <a
                    href={buildWhatsAppUrl(selectedBooking)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setModal(null)}
                    className="w-full bg-emerald-500 text-white py-3.5 rounded-xl font-black hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] text-sm"
                  >
                    <ExternalLink size={16} /> Send Directly on WhatsApp
                  </a>
                  <button
                    onClick={async () => {
                      await copyWhatsAppMessage(selectedBooking);
                      setModal(null);
                    }}
                    className="w-full bg-[#0B0E14] text-[#00D0FF] py-3.5 rounded-xl font-black border border-[#00D0FF]/40 hover:bg-[#00D0FF] hover:text-black transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <MessageCircle size={16} /> Copy WhatsApp Text
                  </button>
                  <button
                    onClick={() => setModal(null)}
                    className="w-full bg-[#1A2235] text-white py-3 rounded-xl font-bold border border-[#2D3748] hover:bg-gray-700 transition-all text-sm"
                  >
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
                <p className="text-gray-400 text-sm text-center mb-6">
                  This will instantly start an Active session for <strong>{selectedBooking.customer_name}</strong> on <strong>{selectedBooking.system_id}</strong> in your main POS.
                </p>

                <div className="bg-[#0B0E14] border border-[#2D3748] rounded-xl p-4 mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-500 font-bold">Duration</span>
                    <span className="text-white font-black">{selectedBooking.duration} Hours</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-bold">Base Cost</span>
                    <span className="text-emerald-400 font-black">₹{getPrice(selectedBooking.duration, 0)}</span>
                  </div>
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
                  <h2 className="text-lg font-black text-white">{selectedBooking ? 'Edit / Swap Booking' : 'New GTA Booking'}</h2>
                  <button onClick={() => setModal(null)} className="text-gray-400 hover:text-white transition-colors p-1"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
                  {/* Direct Atomic Slot Swap */}
                  {selectedBooking && swappableBookings.length > 0 && (
                    <div className="bg-[#0B0E14] border border-[#00D0FF]/30 rounded-xl p-3 space-y-2">
                      <label className="text-[10px] text-[#00D0FF] font-black uppercase tracking-wider flex items-center gap-1.5">
                        <ArrowLeftRight size={12} /> Direct Swap Console & Time With Another Booking
                      </label>
                      <div className="flex gap-2">
                        <select
                          className="flex-1 bg-[#121824] p-2.5 text-xs rounded-lg border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white font-bold"
                          value={swapTargetId}
                          onChange={(e) => setSwapTargetId(e.target.value)}
                        >
                          <option value="">Select booking to swap with...</option>
                          {swappableBookings.map((sb) => (
                            <option key={sb.id} value={sb.id}>
                              {sb.system_id} • {sb.start_time} ({sb.duration}h) – {sb.customer_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!swapTargetId || isProcessing}
                          onClick={handleSwapBookings}
                          className="bg-[#00D0FF] text-black px-3.5 py-2 rounded-lg text-xs font-black disabled:opacity-30 hover:bg-white transition-all whitespace-nowrap"
                        >
                          Swap
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Console</label>
                      <select
                        className="w-full bg-[#0B0E14] p-3 text-sm rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white font-bold"
                        value={formSystem}
                        onChange={(e) => setFormSystem(e.target.value)}
                      >
                        {SYSTEMS.map((sys) => (
                          <option key={sys} value={sys}>{sys}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Date</label>
                      <input
                        type="date"
                        className="w-full bg-[#0B0E14] p-3 text-sm rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white [color-scheme:dark] font-bold"
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Quick-Tap Open Slots for Selected Console & Date */}
                  {modalOpenWindows.length > 0 && (
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">
                        Quick-Fill Free Slot ({formSystem})
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {modalOpenWindows.map((win, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setStartTime24(minutesTo24Hour(win.start))}
                            className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/30 px-2.5 py-1 rounded-lg transition-all"
                          >
                            Start {minutesTo12Hour(win.start)} (until {minutesTo12Hour(win.end)})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Start Time</label>
                      <input
                        type="time"
                        className="w-full bg-[#0B0E14] p-3 text-sm rounded-xl border border-[#2D3748] focus:border-[#00D0FF] outline-none text-white [color-scheme:dark] font-bold"
                        value={startTime24}
                        onChange={(e) => setStartTime24(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">
                        Duration • <span className="text-emerald-400">₹{getPrice(duration, 0)}</span>
                      </label>
                      <div className="flex justify-between items-center bg-[#0B0E14] mt-0.5 p-2 rounded-xl border border-[#2D3748]">
                        <button
                          type="button"
                          onClick={() => setDuration(Math.max(1, duration - 0.5))}
                          className="p-1.5 hover:text-[#00D0FF] bg-[#1A2235] rounded-lg"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="font-bold text-sm">{duration}h</span>
                        <button
                          type="button"
                          onClick={() => setDuration(duration + 0.5)}
                          className="p-1.5 hover:text-[#00D0FF] bg-[#1A2235] rounded-lg"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {startTime24 && (
                    <div
                      className={`p-3 rounded-xl border text-xs font-bold flex items-start gap-2 transition-all ${
                        isOverlapping
                          ? 'bg-red-500/10 border-red-500/30 text-red-400'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      {isOverlapping ? (
                        <>
                          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{overlapWarning}</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                          <span>
                            Time clear ({format12Hour(startTime24)} – {minutesTo12Hour(timeToMinutes(startTime24) + duration * 60)}).
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="pt-2 border-t border-[#1E293B]">
                    <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Gamer Name</label>
                    <div className="flex items-center bg-[#0B0E14] rounded-xl border border-[#2D3748] px-3 focus-within:border-[#00D0FF]">
                      <User size={16} className="text-gray-500 shrink-0" />
                      <input
                        type="text"
                        className="w-full bg-transparent p-3 text-sm outline-none font-bold placeholder-gray-700"
                        placeholder="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-gray-500 font-bold uppercase ml-1 mb-1.5 block">Phone</label>
                    <div className="flex items-center bg-[#0B0E14] rounded-xl border border-[#2D3748] px-3 focus-within:border-[#00D0FF]">
                      <Phone size={16} className="text-gray-500 shrink-0" />
                      <input
                        type="tel"
                        maxLength={10}
                        className="w-full bg-transparent p-3 text-sm outline-none font-bold placeholder-gray-700"
                        placeholder="10-Digit Number"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      type="button"
                      onClick={handleSaveBooking}
                      disabled={isProcessing || isOverlapping || !startTime24 || duration < 1 || !name.trim() || phone.trim().length < 10}
                      className="w-full bg-[#00D0FF] text-black py-4 rounded-xl font-black text-sm disabled:opacity-30 hover:bg-white transition-all shadow-[0_0_15px_rgba(0,208,255,0.2)]"
                    >
                      {isProcessing ? 'Saving...' : selectedBooking ? 'Save Changes' : `Lock Slot • ₹${getPrice(duration, 0)}`}
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