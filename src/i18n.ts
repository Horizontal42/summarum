/** UI localization (en/ru). The engine itself understands both languages at once. */

const dict: Record<string, Record<string, string>> = {
  en: {
    settings: "Settings",
    theme: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
    precision: "Decimal places",
    groupsep: "Thousands separator",
    language: "Language",
    hotkey: "Global hotkey",
    autostart: "Launch at startup",
    fontsize: "Font size",
    extensions: "Extensions folder",
    done: "Done",
    newDocument: "New document",
    untitled: "Untitled",
    copied: "Copied",
    ratesUpdated: "Rates updated",
    ratesOffline: "Offline rates",
    deleteDoc: "Delete document?",
    pressKeys: "Press keys…",
    total: "Total",
    resultswidth: "Results column",
    selection: "Selection",
    rates: "Rates",
    justNow: "just now",
    minAgo: "{}m ago",
    hourAgo: "{}h ago",
    dayAgo: "{}d ago",
    refreshRates: "Click to refresh",
    bindays: "Bin retention (days)",
    datadir: "Data folder",
    backups: "Backups",
    defaultFolder: "Default",
    folderConflict: "The selected folder already contains Summarum sheets. Use them, or replace with the current ones?",
    useExisting: "Use existing",
    replaceMine: "Replace with mine",
    folderChanged: "Data folder changed",
    folderError: "Could not change the data folder",
    hotkeyFailed: "Hotkey is taken by another app",
    decimalsep: "Decimal separator",
    exportCopy: "Copy sheet",
    exportSum: "Save as .sum",
    exportTxt: "Export as text",
    exportPrint: "Print / PDF",
    saved: "Saved",
  },
  ru: {
    settings: "Настройки",
    theme: "Тема",
    system: "Системная",
    light: "Светлая",
    dark: "Тёмная",
    precision: "Знаков после запятой",
    groupsep: "Разделитель тысяч",
    language: "Язык",
    hotkey: "Глобальный хоткей",
    autostart: "Запуск при старте Windows",
    fontsize: "Размер шрифта",
    extensions: "Папка расширений",
    done: "Готово",
    newDocument: "Новый документ",
    untitled: "Без названия",
    copied: "Скопировано",
    ratesUpdated: "Курсы обновлены",
    ratesOffline: "Курсы офлайн",
    deleteDoc: "Удалить документ?",
    pressKeys: "Нажмите клавиши…",
    total: "Сумма",
    resultswidth: "Колонка результатов",
    selection: "Выделение",
    rates: "Курсы",
    justNow: "только что",
    minAgo: "{} мин назад",
    hourAgo: "{} ч назад",
    dayAgo: "{} дн назад",
    refreshRates: "Клик — обновить",
    bindays: "Корзина (дней)",
    datadir: "Папка данных",
    backups: "Бэкапы",
    defaultFolder: "По умолчанию",
    folderConflict: "В выбранной папке уже есть листы Summarum. Использовать их или заменить текущими?",
    useExisting: "Использовать их",
    replaceMine: "Заменить моими",
    folderChanged: "Папка данных изменена",
    folderError: "Не удалось сменить папку данных",
    hotkeyFailed: "Хоткей занят другой программой",
    decimalsep: "Десятичный разделитель",
    exportCopy: "Скопировать лист",
    exportSum: "Сохранить как .sum",
    exportTxt: "Экспорт в текст",
    exportPrint: "Печать / PDF",
    saved: "Сохранено",
  },
};

let lang = "en";

export function setLang(l: string): void {
  lang = dict[l] ? l : "en";
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  }
}

export function t(key: string): string {
  return dict[lang]?.[key] ?? dict.en[key] ?? key;
}

export function detectLang(): string {
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}
