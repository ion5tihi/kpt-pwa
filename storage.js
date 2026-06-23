// storage.js - Менеджер локального збереження даних у localStorage

const MOCK_PATIENTS = [
  {
    code: 'О-41',
    note: 'алко + ГТР, рання реаб.',
    group: true,
    records: [
      {
        date: '2026-06-02',
        sober: 0,
        sleep: 3,
        trigger: 'детокс, 1й день',
        pacs: [5, 5, 4, 5, 5],
        gad7: [3, 3, 3, 2, 2, 2, 3],
        phq9: [2, 2, 3, 3, 2, 2, 2, 1, 0]
      },
      {
        date: '2026-06-06',
        sober: 4,
        sleep: 5,
        trigger: 'конфлікт з дружиною',
        pacs: [3, 3, 2, 3, 3],
        gad7: [2, 2, 3, 2, 1, 2, 2],
        phq9: [2, 1, 2, 2, 1, 2, 1, 1, 0]
      },
      {
        date: '2026-06-13',
        sober: 11,
        sleep: 6,
        trigger: '',
        pacs: [2, 1, 1, 2, 2],
        gad7: [2, 2, 2, 2, 2, 2, 2],
        phq9: [1, 1, 2, 1, 1, 1, 1, 1, 0]
      }
    ]
  },
  { code: 'М-29', note: 'стимулятори', group: false, records: [] },
  { code: 'К-52', note: 'седативні + депресія', group: false, records: [] }
];

const DEFAULT_SETTINGS = {
  apiProvider: 'openai',
  apiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicModel: 'claude-3-5-sonnet-20241022',
  customSystemPrompt: '',
  theme: 'light'
};

export const storage = {
  // Завантажити налаштування
  getSettings() {
    const settings = localStorage.getItem('kpt_settings');
    if (!settings) {
      this.saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(settings) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  },

  // Зберегти налаштування
  saveSettings(settings) {
    localStorage.setItem('kpt_settings', JSON.stringify(settings));
  },

  // Завантажити пацієнтів (з мок-даними при першому запуску)
  getPatients() {
    const patients = localStorage.getItem('kpt_patients');
    if (!patients) {
      this.savePatients(MOCK_PATIENTS);
      return JSON.parse(JSON.stringify(MOCK_PATIENTS));
    }
    try {
      return JSON.parse(patients);
    } catch (e) {
      return JSON.parse(JSON.stringify(MOCK_PATIENTS));
    }
  },

  // Зберегти пацієнтів
  savePatients(patients) {
    localStorage.setItem('kpt_patients', JSON.stringify(patients));
  },

  // Завантажити поточну історію симулятора
  getSimulatorState() {
    const state = localStorage.getItem('kpt_sim_state');
    if (!state) return null;
    try {
      return JSON.parse(state);
    } catch (e) {
      return null;
    }
  },

  // Зберегти поточний стан симулятора (активний пацієнт, історія повідомлень тощо)
  saveSimulatorState(state) {
    localStorage.setItem('kpt_sim_state', JSON.stringify(state));
  },

  // Очистити стан симулятора
  clearSimulatorState() {
    localStorage.removeItem('kpt_sim_state');
  },

  // Завантажити симуляційні випадки (Case) тренажера: { [patientCode]: Case }
  getCases() {
    const raw = localStorage.getItem('kpt_cases');
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
      return {};
    }
  },

  // Зберегти симуляційні випадки
  saveCases(cases) {
    localStorage.setItem('kpt_cases', JSON.stringify(cases || {}));
  },

  // Глобальний облік витрати токенів LLM
  getUsage() {
    const raw = localStorage.getItem('kpt_usage');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },

  saveUsage(usage) {
    localStorage.setItem('kpt_usage', JSON.stringify(usage || {}));
  },

  // Експорт даних у текстовий рядок JSON
  exportData() {
    const data = {
      patients: this.getPatients(),
      settings: this.getSettings()
    };
    return JSON.stringify(data, null, 2);
  },

  // Імпорт даних з об'єкта
  importData(data) {
    if (data && typeof data === 'object') {
      if (Array.isArray(data.patients)) {
        this.savePatients(data.patients);
      }
      if (data.settings && typeof data.settings === 'object') {
        const mergedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
        // Не перезаписуємо API-ключ, якщо в імпортованому файлі його немає
        if (!mergedSettings.apiKey) {
          const current = this.getSettings();
          mergedSettings.apiKey = current.apiKey;
        }
        this.saveSettings(mergedSettings);
      }
      return true;
    }
    return false;
  },

  // Очистити всі дані додатка
  clearAll() {
    localStorage.removeItem('kpt_patients');
    localStorage.removeItem('kpt_settings');
    localStorage.removeItem('kpt_sim_state');
    localStorage.removeItem('kpt_cases');
    localStorage.removeItem('kpt_usage');
  }
};
