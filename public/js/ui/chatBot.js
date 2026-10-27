/**
 * chatBot.js — Groq-powered Platform Assistant for students & faculty.
 *
 * Answers queries strictly related to platform navigation, access, account setup,
 * roster uploads, subject vaults, verification workflows, and troubleshooting.
 */

import { icon } from './icons.js';
import { esc } from '../core/dom.js';

let isOpen = false;
let isBusy = false;
const history = []; // { role: 'user'|'assistant', content: string }

const QUICK_QUESTIONS = [
  '🎓 How do I sign in as a student?',
  '⏳ Why is my student account pending approval?',
  '🏫 How do faculty approve student activations?',
  '📄 How do I upload certificates to subject vaults?',
  '🛡️ How does issuer verification work?'
];

// Helper: Basic safe markdown parser for assistant replies
function formatMarkdown(text) {
  let clean = esc(text);

  // Bold **text**
  clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Inline code `code`
  clean = clean.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Numbered list items: "1. Item" -> formatted div/item
  clean = clean.replace(/^(\d+)\.\s+(.+)$/gm, '<div class="chat-li"><span class="chat-num">$1.</span><span>$2</span></div>');

  // Bullet items: "* Item" or "- Item"
  clean = clean.replace(/^[*-]\s+(.+)$/gm, '<div class="chat-li"><span class="chat-bullet">•</span><span>$1</span></div>');

  // Paragraph breaks
  clean = clean.replace(/\n\n+/g, '<div class="chat-gap"></div>');
  clean = clean.replace(/\n/g, '<br>');

  return clean;
}

export function initChatBot() {
  // Prevent duplicate mount
  if (document.getElementById('platform-chatbot')) return;

  const container = document.createElement('div');
  container.id = 'platform-chatbot';
  container.className = 'chatbot-wrap';
  container.innerHTML = `
    <!-- Floating Trigger Button -->
    <button class="chatbot-trigger" id="chatbot-toggle" type="button" aria-label="Open Platform Assistant">
      <span class="chatbot-trigger-icon">${icon.chat}</span>
      <span class="chatbot-trigger-text">Platform Help</span>
      <span class="chatbot-pulse-dot" aria-hidden="true"></span>
    </button>

    <!-- Floating Chat Window -->
    <div class="chatbot-window" id="chatbot-window" hidden aria-label="Platform Help Chatbot">
      <!-- Header -->
      <div class="chatbot-header">
        <div class="chatbot-brand">
          <div class="chatbot-avatar">${icon.sparkles}</div>
          <div>
            <div class="chatbot-title">Platform Assistant</div>
            <div class="chatbot-status"><span class="chat-online-dot"></span> Student & Faculty Help</div>
          </div>
        </div>
        <div class="chatbot-actions">
          <button class="chatbot-icon-btn" id="chatbot-clear" type="button" title="Clear conversation" aria-label="Clear chat">
            ${icon.trash}
          </button>
          <button class="chatbot-icon-btn" id="chatbot-close" type="button" title="Close chat" aria-label="Close chat">
            ${icon.x}
          </button>
        </div>
      </div>

      <!-- Messages Stream -->
      <div class="chatbot-body" id="chatbot-body">
        <div class="chat-msg chat-msg--assistant">
          <div class="chat-bubble">
            <p>👋 Hello! I am your <strong>Credential Trust Platform Assistant</strong>.</p>
            <p>I can help you with anything related to accessing and using the platform — student account setup, faculty class management, roster uploads, certificate vaults, or verification statuses.</p>
            <div class="chat-chips-label">Frequently asked questions:</div>
            <div class="chat-chips" id="chatbot-chips">
              ${QUICK_QUESTIONS.map(q => `<button type="button" class="chat-chip">${esc(q)}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Input Bar -->
      <form class="chatbot-footer" id="chatbot-form">
        <input 
          type="text" 
          id="chatbot-input" 
          class="chatbot-input" 
          placeholder="Ask a question about the platform..." 
          autocomplete="off" 
          required
        />
        <button type="submit" class="chatbot-send-btn" id="chatbot-send" aria-label="Send message">
          ${icon.send}
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(container);

  // Element handles
  const toggleBtn = document.getElementById('chatbot-toggle');
  const chatWindow = document.getElementById('chatbot-window');
  const closeBtn = document.getElementById('chatbot-close');
  const clearBtn = document.getElementById('chatbot-clear');
  const chatForm = document.getElementById('chatbot-form');
  const chatInput = document.getElementById('chatbot-input');
  const chatBody = document.getElementById('chatbot-body');
  const chipsContainer = document.getElementById('chatbot-chips');

  function openChat() {
    isOpen = true;
    chatWindow.hidden = false;
    toggleBtn.classList.add('is-active');
    chatInput.focus();
    scrollToBottom();
  }

  function closeChat() {
    isOpen = false;
    chatWindow.hidden = true;
    toggleBtn.classList.remove('is-active');
  }

  function scrollToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  toggleBtn.addEventListener('click', () => {
    if (isOpen) closeChat();
    else openChat();
  });

  closeBtn.addEventListener('click', closeChat);

  clearBtn.addEventListener('click', () => {
    history.length = 0;
    chatBody.innerHTML = `
      <div class="chat-msg chat-msg--assistant">
        <div class="chat-bubble">
          <p>Conversation cleared. What can I help you with regarding the Credential Trust Platform?</p>
          <div class="chat-chips" id="chatbot-chips-cleared">
            ${QUICK_QUESTIONS.map(q => `<button type="button" class="chat-chip">${esc(q)}</button>`).join('')}
          </div>
        </div>
      </div>
    `;
    const newChips = document.getElementById('chatbot-chips-cleared');
    if (newChips) {
      newChips.querySelectorAll('.chat-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          chatInput.value = btn.textContent.replace(/^[^\s]+\s/, ''); // strip emoji
          submitMessage();
        });
      });
    }
  });

  // Handle Quick Chips
  chipsContainer.querySelectorAll('.chat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.textContent.replace(/^[^\s]+\s/, ''); // strip emoji
      submitMessage();
    });
  });

  async function submitMessage() {
    const text = chatInput.value.trim();
    if (!text || isBusy) return;

    // Add User Message
    chatInput.value = '';
    isBusy = true;
    appendUserMessage(text);
    history.push({ role: 'user', content: text });

    // Typing indicator
    const typingIndicator = appendTypingIndicator();
    scrollToBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: history.slice(0, -1) // send preceding history
        })
      });

      const data = await res.json();
      typingIndicator.remove();

      if (!res.ok) {
        appendAssistantMessage(data.error || 'Sorry, I encountered an error answering your question. Please try again.');
      } else {
        const reply = data.reply || "I didn't receive a response. Please try again.";
        appendAssistantMessage(reply);
        history.push({ role: 'assistant', content: reply });
      }
    } catch (err) {
      typingIndicator.remove();
      appendAssistantMessage(`Connection error: ${err.message}. Please verify the server is running.`);
    } finally {
      isBusy = false;
      scrollToBottom();
      chatInput.focus();
    }
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitMessage();
  });

  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg--user';
    row.innerHTML = `<div class="chat-bubble">${esc(text)}</div>`;
    chatBody.appendChild(row);
    scrollToBottom();
  }

  function appendAssistantMessage(rawMarkdown) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg--assistant';
    row.innerHTML = `<div class="chat-bubble">${formatMarkdown(rawMarkdown)}</div>`;
    chatBody.appendChild(row);
    scrollToBottom();
  }

  function appendTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg--assistant chat-typing-row';
    row.innerHTML = `
      <div class="chat-bubble chat-typing">
        <span class="chat-dot"></span>
        <span class="chat-dot"></span>
        <span class="chat-dot"></span>
      </div>
    `;
    chatBody.appendChild(row);
    return row;
  }
}
