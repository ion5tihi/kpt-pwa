// speech.js - Модуль голосового введення українською мовою через Web Speech API

export class SpeechRecognizer {
  constructor() {
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    } catch (e) {
      console.error('SpeechRecognition initialization failed:', e);
      this.recognition = null;
    }
    this.isListening = false;
    this.onResultCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;

    if (this.recognition) {
      this.recognition.continuous = false; // зупиняється після закінчення фрази
      this.recognition.interimResults = true; // показувати проміжні результати
      this.recognition.lang = 'uk-UA'; // українська мова

      this.recognition.onstart = () => {
        this.isListening = true;
      };

      this.recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (this.onResultCallback) {
          const isFinal = event.results[event.results.length - 1].isFinal;
          this.onResultCallback(transcript, isFinal);
        }
      };

      this.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        this.isListening = false;
        if (this.onErrorCallback) {
          this.onErrorCallback(event.error);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.onEndCallback) {
          this.onEndCallback();
        }
      };
    }
  }

  // Перевірка підтримки браузером
  isSupported() {
    return this.recognition !== null;
  }

  // Запуск прослуховування
  start(onResult, onEnd, onError) {
    if (!this.isSupported() || this.isListening) return;

    this.onResultCallback = onResult;
    this.onEndCallback = onEnd;
    this.onErrorCallback = onError;

    try {
      this.recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      if (this.onErrorCallback) this.onErrorCallback('failed-to-start');
    }
  }

  // Зупинка прослуховування
  stop() {
    if (!this.isSupported() || !this.isListening) return;
    try {
      this.recognition.stop();
    } catch (e) {
      console.error('Failed to stop speech recognition:', e);
    }
  }
}
