# 🛡️ Speak & Fix – Gemini Polish Proxy (Vercel)

A tiny, secure serverless API that forwards **text** to **Google Gemini** for
grammar/punctuation polishing and returns the corrected text.

- ⚡️ **Fast**: Vercel serverless function (Node 18+)
- 🔑 **Key handling**: Accepts a Gemini API key in the request body or uses an environment variable
- 🌍 **CORS enabled**: Safe to call from the Chrome extension
- 🧰 **Simple contract**: `{ text, apiKey } → { text }`

---

## ✨ Endpoint

