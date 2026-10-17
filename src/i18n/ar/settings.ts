import type { settings as en } from "../en/settings";
import type { Messages } from "../types";

export const settings: Messages<typeof en> = {
  language: {
    label: "اللغة",
    system: "النظام",
  },
  dialog: {
    title: "الإعدادات",
    sections: "أقسام الإعدادات",
  },
  sections: {
    appearance: "المظهر",
    terminal: "الطرفية",
    ssh: "SSH",
    files: "الملفات",
    ai: "الذكاء الاصطناعي",
    about: "حول",
  },
  appearance: {
    colourScheme: "نظام الألوان",
    dark: "داكن",
    light: "فاتح",
    preview: "معاينة {name}",
    fontFamily: "عائلة الخط",
    fontSize: "حجم الخط",
    fontHelp:
      "تغيّر Ctrl+= / Ctrl+- / Ctrl+0 حجم الخط. تحتاج سمات موجّه الأوامر التي ترسم أيقونات (Powerlevel10k وagnoster وStarship) إلى خط Nerd Font كعائلة للخط.",
    hideSidebar: "إخفاء الشريط الجانبي تمامًا عند طيّه",
    sidebarHelp:
      "يطوي Ctrl+Shift+B أو زر شريط الأدوات الشريط الجانبي إلى أيقونات علاماته، أو يخفيه تمامًا مع هذا الخيار.",
  },
  terminal: {
    shell: "الصدفة للطرفيات المحلية",
    shellDefault: "افتراضي النظام",
    shellDefaultNamed: "افتراضي النظام ({name})",
    shellOther: "أخرى…",
    shellProgram: "البرنامج",
    shellArgs: "الوسائط",
    chooseShell: "اختر صدفة",
    shellHelp: "تفتح الطرفيات المحلية الجديدة هذه الصدفة. تُفصل الوسائط بمسافات؛ ضع الوسيطة التي تحتوي على مسافات بين علامتي اقتباس.",
    copyOnSelect: "النسخ عند التحديد",
    rightClickPastes: "اللصق بالنقر بزر الماوس الأيمن",
    confirmMultilinePaste: "تأكيد لصق عدة أسطر",
    rightClickHelp: "عندما يلصق النقر بزر الماوس الأيمن، يفتح Ctrl+النقر الأيمن قائمة الطرفية.",
  },
  ssh: {
    remoteMonitor: "شريط المراقب البعيد (علامات تبويب SSH)",
    remoteMonitorHelp:
      "شريط أسفل كل جزء SSH يعرض CPU الخادم والذاكرة والقرص والشبكة والمستخدمين، ويُقرأ عبر الاتصال نفسه. متاح أيضًا في الأدوات.",
  },
  files: {
    textEditor: "محرر النصوص",
    systemDefault: "افتراضي النظام",
    useSystemDefault: "استخدام افتراضي النظام",
    chooseEditor: "اختر محرر نصوص",
    textEditorHelp:
      "يفتح محرر النصوص الملفات من متصفح SFTP: برنامج، أو أمر مثل {command}؛ اتركه فارغًا لاستخدام افتراضي النظام.",
  },
  ai: {
    inlineSuggestions: "الاقتراحات المضمّنة",
    inlineSuggestionsHelp:
      "اقتراح رمادي لبقية الأمر أثناء الكتابة. يقبله السهم الأيمن أو End، ويقبل Ctrl+السهم الأيمن كلمة واحدة.",
    commandHistory: "سجل الأوامر",
    clearHistory: "مسح السجل",
    historyCleared: "تم مسح السجل.",
    historyClearFailed: "تعذّر مسح السجل: {error}",
    historyHelp:
      "تُحفظ الأوامر التي تنفّذها على هذا الكمبيوتر، لكل مضيف، لاقتراحها مجددًا. لا تُسجَّل أبدًا الأسطر التي تبدأ بمسافة ولا كلمات المرور ولا البرامج بملء الشاشة.",
    aiSuggestions: "اقتراحات الذكاء الاصطناعي",
    aiSuggestionsHelp:
      "عندما لا يجد السجل شيئًا، يُسأل مزوّد الذكاء الاصطناعي. لا يُرسل إلا السطر المكتوب والمجلد الحالي وآخر أوامر السجل، ولا تُرسل مخرجات الطرفية أبدًا.",
    provider: "المزوّد",
    openCodeGoNote:
      "OpenCode Go مخصص لوكلاء البرمجة ويراقب حركة المرور؛ والاقتراحات المضمّنة بالذكاء الاصطناعي ترسل طلبات قصيرة كثيرة.",
    baseUrl: "عنوان URL الأساسي",
    model: "النموذج",
    historyContext: "أوامر السجل المرسلة كسياق",
    chooseModel: "اختر نموذجًا",
    modelOption: "{name} ({id})",
    modelOptionUnsupported: "{name} ({id}) — غير مدعوم بعد",
    refreshModels: "تحديث النماذج",
    loadingModels: "جارٍ تحميل النماذج…",
    modelsError: "{error} اكتب معرّف نموذج من {url}.",
    apiKey: "مفتاح API",
    keyChecking: "جارٍ التحقق من حلقة المفاتيح…",
    keySaved: "يوجد مفتاح محفوظ",
    keyNone: "لا يوجد مفتاح محفوظ",
    keyUnavailable: "حلقة المفاتيح غير متاحة",
    keyReplacePlaceholder: "اكتب مفتاحًا جديدًا لاستبداله",
    keyPastePlaceholder: "الصق المفتاح",
    saveKey: "حفظ المفتاح",
    removeKey: "إزالة المفتاح",
    saveKeyFailed: "تعذّر حفظ المفتاح: {error}",
    removeKeyFailed: "تعذّرت إزالة المفتاح: {error}",
    assistantShortcut: "اختصار المساعد",
    shortcutInvalid: "استخدم Ctrl أو Alt أو Meta مع مفتاح.",
    shortcutTaken: "{shortcut} مستخدم بالفعل في PlexusTerm.",
    shortcutCapturing: "اضغط مجموعة المفاتيح الجديدة، أو Esc للإبقاء عليها.",
    shortcutIdle: "انقر الحقل لتغييره.",
  },
  about: {
    version: "الإصدار {version}",
    description:
      "طرفية ومدير جلسات بعيدة لنظامي Linux وWindows: صدفات محلية وSSH وSFTP وأنفاق واتصال تسلسلي وTelnet وMosh في نافذة واحدة.",
    credits: "أنظمة الألوان من iTerm2-Color-Schemes (MIT) ومؤلفيها؛ راجع {notices}.",
    notices: "إشعارات الجهات الخارجية",
  },
};
