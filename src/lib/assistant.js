import { supabase, supabaseAnonKey, supabaseUrl } from "./supabaseClient.js";

const maxHistory = 20;

export function initAssistant() {
  const root = document.getElementById("erp-assistant");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  const panel = root.querySelector(".assistant-panel");
  const messages = root.querySelector(".assistant-messages");
  const form = root.querySelector(".assistant-form");
  const input = root.querySelector(".assistant-input");
  const sendButton = root.querySelector(".assistant-send");
  const status = root.querySelector(".assistant-status");
  const history = [];

  const scrollToLatest = () => { messages.scrollTop = messages.scrollHeight; };
  const setOpen = (open) => {
    root.classList.toggle("is-open", open);
    panel.hidden = !open;
    if (open) window.setTimeout(() => input.focus(), 0);
  };
  const addMessage = (role, text, kind = "") => {
    const bubble = document.createElement("div");
    bubble.className = `assistant-message ${role} ${kind}`.trim();
    bubble.textContent = text;
    messages.appendChild(bubble);
    scrollToLatest();
  };
  const setLoading = (loading) => {
    sendButton.disabled = loading;
    input.disabled = loading;
    status.hidden = !loading;
  };
  const ask = async (question) => {
    const content = question.trim();
    if (!content || sendButton.disabled) return;
    addMessage("user", content);
    history.push({ role: "user", content });
    while (history.length > maxHistory) history.shift();
    input.value = "";
    setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch(`${supabaseUrl}/functions/v1/erp-assistant`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          apikey: supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messages: history })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.message) throw new Error(result.error || "The assistant could not respond right now.");
      history.push({ role: "assistant", content: result.message });
      while (history.length > maxHistory) history.shift();
      addMessage("assistant", result.message);
    } catch (error) {
      addMessage("assistant", error.message || "The assistant could not respond right now.", "error");
    } finally {
      setLoading(false);
      input.focus();
    }
  };

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-assistant-action]")?.dataset.assistantAction;
    if (action === "open") setOpen(true);
    if (action === "close") setOpen(false);
    if (action === "clear") {
      history.length = 0;
      messages.innerHTML = "";
      addMessage("assistant", "Hi! I can help you understand the ERP and find your way around it.");
      root.querySelectorAll(".assistant-suggestion").forEach((button) => { button.hidden = false; });
    }
    const suggestion = event.target.closest(".assistant-suggestion");
    if (suggestion) {
      suggestion.hidden = true;
      ask(suggestion.textContent);
    }
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); ask(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
}
