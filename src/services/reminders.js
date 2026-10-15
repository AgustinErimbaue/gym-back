import { Op } from "sequelize";
import { Attendance, ClassBooking, GymClass, Member, MemberPushToken, Membership, NotificationLog } from "../models/index.js";
import { getArgentinaDate } from "./mercadoPago.js";
import { sendPushToMember } from "./pushNotifications.js";

const checkIntervalMs = 5 * 60 * 1000;
const inactivityDays = 5;
const classReminderMinutes = 60;
const expiryReminderDays = [3, 1];
const daytimeHours = { from: 9, to: 20 };

export function addDaysToDate(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function argentinaHour(now = new Date()) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

export function weekKey(date) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDaysToDate(date, -((day + 6) % 7));
}

// Registra el aviso antes de enviarlo para que cada uno salga una sola vez.
async function claim(memberId, kind, refKey) {
  const [, created] = await NotificationLog.findOrCreate({
    where: { memberId, kind, refKey },
  });
  return created;
}

async function notify(memberId, kind, refKey, notification) {
  if (!(await claim(memberId, kind, refKey))) return;
  try {
    await sendPushToMember(memberId, notification);
  } catch (error) {
    console.error(`No se pudo enviar el aviso ${kind}:`, error.message);
  }
}

async function remindExpiringMemberships(now) {
  const today = getArgentinaDate(now);
  const dates = expiryReminderDays.map((days) => addDaysToDate(today, days));
  const memberships = await Membership.findAll({
    where: { status: "active", endDate: { [Op.in]: dates } },
    attributes: ["id", "memberId", "endDate"],
  });
  for (const membership of memberships) {
    const days = expiryReminderDays[dates.indexOf(membership.endDate)];
    await notify(membership.memberId, "membership-expiring", `${membership.id}:${days}`, {
      title: "Tu membresía está por vencer",
      body: days === 1
        ? "Tu membresía vence mañana. Renuévala para seguir entrenando."
        : `Tu membresía vence en ${days} días. Renuévala para no perder el acceso.`,
      data: { type: "membership-expiring" },
    });
  }
}

async function remindToTrain(now) {
  const today = getArgentinaDate(now);
  const since = new Date(now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);
  const memberships = await Membership.findAll({
    where: {
      status: "active",
      startDate: { [Op.lte]: addDaysToDate(today, -inactivityDays) },
      endDate: { [Op.gte]: today },
    },
    attributes: ["memberId"],
    include: [{ model: Member, required: true, attributes: [], where: { status: "active" } }],
  });
  const memberIds = [...new Set(memberships.map(({ memberId }) => memberId))];
  if (!memberIds.length) return;

  const withTokens = new Set(
    (await MemberPushToken.findAll({ where: { memberId: memberIds }, attributes: ["memberId"], raw: true }))
      .map(({ memberId }) => memberId),
  );
  const recent = new Set(
    (await Attendance.findAll({
      where: { memberId: memberIds, checkedInAt: { [Op.gte]: since } },
      attributes: ["memberId"],
      raw: true,
    })).map(({ memberId }) => memberId),
  );
  for (const memberId of memberIds) {
    if (!withTokens.has(memberId) || recent.has(memberId)) continue;
    await notify(memberId, "train-reminder", weekKey(today), {
      title: "¡Te extrañamos en IRONCORE!",
      body: `Hace más de ${inactivityDays} días que no entrenas. Hoy es un buen día para volver.`,
      data: { type: "train-reminder" },
    });
  }
}

async function remindUpcomingClasses(now) {
  const classes = await GymClass.findAll({
    where: {
      isCancelled: false,
      startsAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + classReminderMinutes * 60 * 1000) },
    },
  });
  for (const gymClass of classes) {
    const bookings = await ClassBooking.findAll({ where: { classId: gymClass.id }, attributes: ["memberId"] });
    for (const { memberId } of bookings) {
      await notify(memberId, "class-reminder", String(gymClass.id), {
        title: "Tu clase empieza pronto",
        body: `${gymClass.name} comienza en menos de una hora.`,
        data: { type: "class-reminder" },
      });
    }
  }
}

export async function runReminders(now = new Date()) {
  await remindUpcomingClasses(now);
  const hour = argentinaHour(now);
  if (hour >= daytimeHours.from && hour < daytimeHours.to) {
    await remindExpiringMemberships(now);
    await remindToTrain(now);
  }
}

export function startReminderScheduler() {
  if (process.env.REMINDERS_ENABLED === "false") return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runReminders();
    } catch (error) {
      console.error("No se pudieron procesar los recordatorios:", error.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 30 * 1000).unref();
  return setInterval(tick, checkIntervalMs).unref();
}
