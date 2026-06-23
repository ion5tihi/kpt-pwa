// api.js - Інтеграція з OpenAI та Anthropic API

import {
  systemPrompt, evalPrompt, structuredEvalPrompt,
  patientGenerationPrompt, repeatSessionPrompt
} from './src/prompts/prompts.js';
import { fetchWithRetry } from './src/net/fetchRetry.js';
import { assessmentJsonSchema } from './src/clinic/assessment.js';

// Хук обліку токенів: app.js реєструє свій збирач через setUsageReporter().
let usageReporter = null;
export function setUsageReporter(fn) { usageReporter = fn; }
function reportUsage(info) {
  if (usageReporter) { try { usageReporter(info); } catch (e) { /* облік не має ламати потік */ } }
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"; // Примітка: може вимагати CORS проксі у браузері

export const TYPE_LABEL = {
  alko: 'алкогольна залежність',
  opio: 'опіоїдна залежність',
  stim: 'залежність від стимуляторів',
  sed: 'залежність від седативних засобів',
  poly: 'полінаркоманія',
  gambl: 'гемблінг (ігрова залежність)',
  'dual-dep': 'подвійний діагноз: залежність + депресія',
  'dual-gtr': 'подвійний діагноз: залежність + Генералізований тривожний розлад (ГТР)',
  'dual-ptsr': 'подвійний діагноз: залежність + ПТСР',
  'dual-panic': 'подвійний діагноз: залежність + панічний розлад',
  'pure-dep': 'чиста депресія (без залежності)',
  'pure-ocd': 'чистий ОКР (обсесивно-компульсивний розлад)',
  'pure-phobia': 'фобічний розлад'
};

export async function callOpenAI(settings, messages, jsonMode = false, jsonSchema = null) {
  const { apiKey, openaiModel } = settings;
  if (!apiKey) {
    throw new Error("API-ключ не вказано. Будь ласка, введіть його в налаштуваннях.");
  }

  const body = {
    model: openaiModel || "gpt-4o-mini",
    messages: messages,
    temperature: 0.7
  };

  // T3.2: строгий structured output, якщо передано схему; інакше — json_object.
  if (jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "session_assessment", strict: true, schema: jsonSchema }
    };
  } else if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetchWithRetry(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Код помилки: ${response.status}`;
    throw new Error(`OpenAI помилка: ${message}`);
  }

  const data = await response.json();
  if (data.usage) {
    reportUsage({
      provider: 'openai',
      model: body.model,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens
    });
  }
  return data.choices[0].message.content;
}

// Anthropic вимагає, щоб масив messages починався з ролі "user" і ролі чергувалися.
// Перша репліка пацієнта зберігається як assistant, тому за потреби додаємо
// технічне user-повідомлення на початок, щоб не отримати помилку 400.
function normalizeAnthropicMessages(messages) {
  const msgs = [...messages];
  if (msgs.length && msgs[0].role === 'assistant') {
    msgs.unshift({ role: 'user', content: '(Пацієнт заходить до кабінету.)' });
  }
  return msgs;
}

export async function callAnthropic(settings, system, messages) {
  const { apiKey, anthropicModel } = settings;
  if (!apiKey) {
    throw new Error("API-ключ не вказано. Будь ласка, введіть його в налаштуваннях.");
  }

  // Anthropic вимагає CORS або проксі, робимо прямий запит
  const response = await fetchWithRetry(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" // Для клієнтських застосунків
    },
    body: JSON.stringify({
      model: anthropicModel || "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
      system: system,
      messages: normalizeAnthropicMessages(messages)
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Код помилки: ${response.status}`;
    throw new Error(`Anthropic помилка: ${message}`);
  }

  const data = await response.json();
  if (data.usage) {
    reportUsage({
      provider: 'anthropic',
      model: anthropicModel || "claude-3-5-sonnet-20241022",
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens
    });
  }
  return data.content[0].text;
}

export const api = {
  // Згенерувати пацієнта
  async generatePatient(settings, config) {
    const fullPrompt = patientGenerationPrompt(config, TYPE_LABEL[config.type] || config.type);

    const system = systemPrompt(settings.customSystemPrompt);
    const messages = [{ role: "user", content: fullPrompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      responseText = await callAnthropic(settings, system, messages);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], true);
    }

    return this.parseResponse(responseText);
  },

  // Надіслати нову репліку у чат
  async sendTurn(settings, history, userText, hiddenState, patientCard) {
    const system = systemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    const messages = [...history, { role: "user", content: userText }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      const cleanHistory = history.map(h => ({ role: h.role, content: h.content }));
      cleanHistory.push({ role: "user", content: userText });
      responseText = await callAnthropic(settings, system, cleanHistory);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], true);
    }

    return this.parseResponse(responseText);
  },

  // Отримати оцінку CTS-R
  async evaluateSession(settings, chatHistory, hiddenState, patientCard) {
    const evalTextPrompt = evalPrompt();
    const system = systemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    
    // Формуємо історію для оцінки: додаємо промпт оцінки в кінець
    const messages = [...chatHistory, { role: "user", content: evalTextPrompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      const cleanHistory = chatHistory.map(h => ({ role: h.role, content: h.content }));
      cleanHistory.push({ role: "user", content: evalTextPrompt });
      responseText = await callAnthropic(settings, system, cleanHistory);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], false);
    }

    return responseText;
  },

  // Отримати СТРУКТУРОВАНУ оцінку (JSON) — вхід для симуляційного рушія.
  // Окремий виклик від evaluateSession, щоб не ламати текстовий звіт для людини.
  async evaluateSessionStructured(settings, chatHistory, hiddenState, patientCard) {
    const prompt = structuredEvalPrompt();
    const system = systemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    const messages = [...chatHistory, { role: "user", content: prompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      const cleanHistory = chatHistory.map(h => ({ role: h.role, content: h.content }));
      cleanHistory.push({ role: "user", content: prompt });
      responseText = await callAnthropic(settings, system, cleanHistory);
    } else {
      const openaiMessages = [{ role: "system", content: system }, ...messages];
      // T3.2: спершу строга json_schema; якщо модель/ендпойнт її не підтримує — фолбек на json_object.
      try {
        responseText = await callOpenAI(settings, openaiMessages, true, assessmentJsonSchema());
      } catch (err) {
        console.warn('json_schema недоступна, фолбек на json_object:', err?.message || err);
        responseText = await callOpenAI(settings, openaiMessages, true);
      }
    }

    return this.parseResponse(responseText);
  },

  // Згенерувати повторну сесію (повторний прийом)
  async generateRepeatSession(settings, hiddenState, patientCard, sessionNumber, stage, patientName) {
    const system = systemPrompt(settings.customSystemPrompt, hiddenState, patientCard);
    
    const prompt = repeatSessionPrompt({ sessionNumber, stage, patientName });

    const messages = [{ role: "user", content: prompt }];

    let responseText;
    if (settings.apiProvider === 'anthropic') {
      responseText = await callAnthropic(settings, system, messages);
    } else {
      responseText = await callOpenAI(settings, [{ role: "system", content: system }, ...messages], true);
    }

    return this.parseResponse(responseText);
  },

  // Допоміжний метод парсингу JSON
  parseResponse(text) {
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const startIdx = cleanText.indexOf('{');
    const endIdx = cleanText.lastIndexOf('}');
    
    if (startIdx > -1 && endIdx > -1) {
      cleanText = cleanText.slice(startIdx, endIdx + 1);
    }
    
    try {
      return JSON.parse(cleanText);
    } catch (e) {
      console.error("Помилка парсингу JSON від ШІ:", text);
      throw new Error("Не вдалося розпарсити відповідь ШІ як JSON. Перевірте консоль розробника.");
    }
  }
};
