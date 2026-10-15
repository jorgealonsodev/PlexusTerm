import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "محلي (-L)",
    remote: "بعيد (-R)",
    dynamic: "SOCKS5 ديناميكي (-D)",
  },
  panel: {
    title: "أنفاق SSH",
    new: "جديد",
    startAll: "بدء الكل",
    stopAll: "إيقاف الكل",
    readError: "تعذّرت قراءة الأنفاق المحفوظة: {message}. تم تعطيل التحرير لحماية الملف.",
    saveError: "تعذّر حفظ الأنفاق: {error}",
    empty: "لا توجد أنفاق بعد.",
    missingSession: "جلسة مفقودة",
    via: "{tunnel} عبر {session}",
    hint: "تستمع الأنفاق على 127.0.0.1 ما لم تختر عنوانًا آخر.",
  },
  state: {
    stopped: "متوقف",
    starting: "جارٍ البدء…",
    running: "قيد التشغيل",
    error: "خطأ",
  },
  edit: {
    newTitle: "نفق SSH جديد",
    editTitle: "تحرير النفق",
    namePlaceholder: "يُنشأ من المنافذ",
    type: "النوع",
    sshSession: "جلسة SSH",
    chooseSession: "اختر جلسة محفوظة…",
    noSessions: "احفظ جلسة SSH أولًا؛ فالأنفاق تستخدم اتصالها.",
    listenAddressServer: "عنوان الاستماع على الخادم",
    listenAddress: "عنوان الاستماع",
    exposedRemote: "الاستماع على {host} يتيح لأجهزة أخرى الوصول إلى منفذ الخادم. استخدم 127.0.0.1 لإبقائه خاصًا.",
    exposedLocal: "الاستماع على {host} يتيح لأجهزة أخرى استخدام هذا النفق. استخدم 127.0.0.1 لإبقائه خاصًا.",
    destinationFromHere: "الوجهة (من هذا الجهاز)",
    destinationFromServer: "الوجهة (من الخادم)",
    dynamicHint: "تستخدم التطبيقات هذا المنفذ كوكيل SOCKS5؛ والخادم هو من يفتح الاتصالات.",
  },
  form: {
    chooseSession: "اختر جلسة SSH محفوظة",
    invalidListenPort: "يجب أن يكون منفذ الاستماع رقمًا بين 1 و65535",
    destHostRequired: "مضيف الوجهة مطلوب",
    invalidDestPort: "يجب أن يكون منفذ الوجهة رقمًا بين 1 و65535",
  },
  file: {
    invalidJson: "ملف الأنفاق ليس JSON صالحًا: {error}",
    unsupportedVersion: "إصدار ملف الأنفاق غير مدعوم",
    invalidTunnels: "ملف الأنفاق يحتوي على أنفاق غير صالحة",
  },
  launcher: {
    sessionGone: "جلستها المحفوظة لم تعد موجودة؛ حرّر النفق لاختيار جلسة أخرى.",
    startFailed: "تعذّر بدء النفق: {error}",
  },
};
