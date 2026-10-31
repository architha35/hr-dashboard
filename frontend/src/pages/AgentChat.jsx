import { useState, useRef, useEffect } from "react";
import { API_BASE_URL } from "../api/config";


const AgentChat = () => {
    const [messages, setMessages] = useState([
        {
            id: "msg_init",
            role: "assistant",
            content: "Hello! I am your **Agentic AI HR Assistant**. I can help you search employees, manage leave and work-from-home records, perform organizational analytics, and execute changes with full database verification.\n\nWhat would you like to do today?",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),

        }
    ]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

    const chatEndRef = useRef(null);
    const inputRef = useRef(null);

    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSendMessage = async (textToSend) => {
        const text = (textToSend || inputValue).trim();
        if (!text || isLoading) return;

        const userMsg = {
            id: `usr_${Date.now()}`,
            role: "user",
            content: text,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        };

        setMessages((prev) => [...prev, userMsg]);
        setInputValue("");
        setIsLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/agent/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    sessionId
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || errData.message || "Failed to process request");
            }

            const data = await response.json();

            const assistantMsg = {
                id: `ast_${Date.now()}`,
                role: "assistant",
                content: data.message,
                status: data.status,
                actionProposal: data.actionProposal,
                structuredData: data.structuredData,
                actionResult: data.actionResult,
                suggestedPrompts: data.suggestedPrompts,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            };

            setMessages((prev) => [...prev, assistantMsg]);
        } catch (err) {
            console.error("Agent chat error:", err);
            setMessages((prev) => [
                ...prev,
                {
                    id: `err_${Date.now()}`,
                    role: "assistant",
                    content: `⚠️ **Error**: ${err.message || "Something went wrong while communicating with the agent. Please try again."}`,
                    isError: true,
                    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
            ]);
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    };

    const handleConfirmationAction = async (actionId, confirmed) => {
        if (isLoading) return;
        setIsLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/agent/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    confirmationAction: {
                        actionId,
                        confirmed
                    }
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || errData.message || "Failed to execute confirmation");
            }

            const data = await response.json();

            // Mark the proposal as handled in the message history
            setMessages((prev) =>
                prev.map((msg) => {
                    if (msg.actionProposal && msg.actionProposal.id === actionId) {
                        return {
                            ...msg,
                            actionProposal: {
                                ...msg.actionProposal,
                                handled: true,
                                decision: confirmed ? "CONFIRMED" : "CANCELLED"
                            }
                        };
                    }
                    return msg;
                })
            );

            // Add the agent's outcome message
            const outcomeMsg = {
                id: `act_res_${Date.now()}`,
                role: "assistant",
                content: data.message,
                status: data.status,
                actionResult: data.actionResult,
                structuredData: data.structuredData,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            };

            setMessages((prev) => [...prev, outcomeMsg]);
        } catch (err) {
            console.error("Confirmation error:", err);
            setMessages((prev) => [
                ...prev,
                {
                    id: `err_${Date.now()}`,
                    role: "assistant",
                    content: `⚠️ **Error executing action**: ${err.message}`,
                    isError: true,
                    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClearChat = () => {
        setMessages([
            {
                id: "msg_init_cleared",
                role: "assistant",
                content: "Chat session reset. What would you like to assist with?",
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),

            }
        ]);
    };

    return (
        <div className="flex h-[82vh] flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Chat Header */}
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/80 px-6 py-3.5 backdrop-blur">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            HR Agentic AI Assistant
                            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                Connected to PostgreSQL
                            </span>
                        </h2>
                        <p className="text-xs text-gray-500">Autonomous tool execution, parameter validation & audit logging</p>
                    </div>
                </div>

                <button
                    onClick={handleClearChat}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-xs hover:bg-gray-50 hover:text-gray-900 transition"
                >
                    Clear Session
                </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 bg-gradient-to-b from-gray-50/30 to-white">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-3.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        {/* Agent Avatar */}
                        {msg.role === "assistant" && (
                            <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs text-xs font-bold">
                                AI
                            </div>
                        )}

                        <div className={`max-w-[85%] sm:max-w-[75%] space-y-3`}>
                            {/* Message Bubble */}
                            <div
                                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${msg.role === "user"
                                    ? "bg-blue-600 text-white rounded-tr-none"
                                    : msg.isError
                                        ? "bg-red-50 text-red-800 border border-red-200 rounded-tl-none"
                                        : "bg-white text-gray-800 border border-gray-200/90 rounded-tl-none"
                                    }`}
                            >
                                <div className="whitespace-pre-wrap">
                                    {msg.content.split("\n").map((line, i) => (
                                        <p key={i} className={i > 0 ? "mt-1.5" : ""}>
                                            {line.split(/(\*\*.*?\*\*)/g).map((part, j) => {
                                                if (part.startsWith("**") && part.endsWith("**")) {
                                                    return (
                                                        <strong key={j} className="font-semibold">
                                                            {part.slice(2, -2)}
                                                        </strong>
                                                    );
                                                }
                                                return part;
                                            })}
                                        </p>
                                    ))}
                                </div>
                                <div
                                    className={`mt-1.5 text-[10px] ${msg.role === "user" ? "text-blue-100 text-right" : "text-gray-400"
                                        }`}
                                >
                                    {msg.timestamp}
                                </div>
                            </div>

                            {/* Structured Data: Table */}
                            {msg.structuredData && msg.structuredData.type === "table" && (
                                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
                                    {msg.structuredData.title && (
                                        <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                                            {msg.structuredData.title}
                                        </div>
                                    )}
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                                                <tr>
                                                    {msg.structuredData.columns.map((col, idx) => (
                                                        <th key={idx} className="px-3.5 py-2.5 font-semibold">
                                                            {col}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {msg.structuredData.rows.map((row, rIdx) => (
                                                    <tr key={rIdx} className="hover:bg-blue-50/50 transition">
                                                        {row.map((cell, cIdx) => (
                                                            <td key={cIdx} className="px-3.5 py-2 text-gray-700">
                                                                {cell}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Structured Data: Metrics Cards */}
                            {msg.structuredData && msg.structuredData.type === "metrics" && (
                                <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs">
                                    {msg.structuredData.title && (
                                        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            {msg.structuredData.title}
                                        </h4>
                                    )}
                                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                                        {msg.structuredData.metrics.map((m, mIdx) => (
                                            <div key={mIdx} className="rounded-lg border border-gray-100 bg-gray-50/80 p-2.5 text-center">
                                                <p className="text-lg font-bold text-gray-900">{m.value}</p>
                                                <p className="text-[11px] font-medium text-gray-500">{m.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Structured Data: Single Card */}
                            {msg.structuredData && msg.structuredData.type === "card" && (
                                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
                                    {msg.structuredData.title && (
                                        <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                                            {msg.structuredData.title}
                                        </h4>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {Object.entries(msg.structuredData.data || {}).map(([key, val], kIdx) => (
                                            <div key={kIdx} className="rounded bg-gray-50 p-2">
                                                <span className="font-medium text-gray-500">{key}: </span>
                                                <span className="font-semibold text-gray-800">{String(val)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Interactive Confirmation Proposal Card */}
                            {msg.actionProposal && (
                                <div className={`rounded-xl border p-4 shadow-sm transition ${msg.actionProposal.handled
                                    ? msg.actionProposal.decision === "CONFIRMED"
                                        ? "border-emerald-200 bg-emerald-50/50"
                                        : "border-gray-200 bg-gray-50/50 opacity-70"
                                    : "border-amber-200 bg-amber-50/40"
                                    }`}>
                                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-200/50">
                                        <div className="flex items-center gap-2">
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white text-xs">
                                                ⚠️
                                            </span>
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                                                {msg.actionProposal.title || "Confirmation Required"}
                                            </h4>
                                        </div>
                                        {msg.actionProposal.handled ? (
                                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${msg.actionProposal.decision === "CONFIRMED"
                                                ? "bg-emerald-100 text-emerald-800"
                                                : "bg-gray-200 text-gray-700"
                                                }`}>
                                                {msg.actionProposal.decision === "CONFIRMED" ? "Confirmed & Executed" : "Cancelled"}
                                            </span>
                                        ) : (
                                            <span className="text-[11px] font-medium text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded-full">
                                                Awaiting HR Approval
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-xs font-medium text-gray-800 mb-2.5">
                                        {msg.actionProposal.summary}
                                    </p>

                                    {/* Parameter Details Table */}
                                    {msg.actionProposal.details && (
                                        <div className="mb-3 rounded-lg border border-amber-100 bg-white p-2.5 text-xs grid grid-cols-2 gap-2">
                                            {Object.entries(msg.actionProposal.details).map(([k, v], idx) => (
                                                <div key={idx} className="flex flex-col">
                                                    <span className="text-[10px] uppercase font-bold text-gray-400">{k}</span>
                                                    <span className="font-semibold text-gray-900">{String(v)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {msg.actionProposal.warning && (
                                        <p className="text-[11px] text-amber-800 italic mb-3">
                                            {msg.actionProposal.warning}
                                        </p>
                                    )}

                                    {/* Action Buttons */}
                                    {!msg.actionProposal.handled && (
                                        <div className="flex items-center gap-2.5 pt-1">
                                            <button
                                                disabled={isLoading}
                                                onClick={() => handleConfirmationAction(msg.actionProposal.id, true)}
                                                className="flex-1 rounded-lg bg-emerald-600 py-2 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                                            >
                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                                </svg>
                                                Confirm & Execute
                                            </button>
                                            <button
                                                disabled={isLoading}
                                                onClick={() => handleConfirmationAction(msg.actionProposal.id, false)}
                                                className="rounded-lg border border-gray-300 bg-white py-2 px-4 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition disabled:opacity-50"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Suggested Prompts Pill Container */}
                            {msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && (
                                <div className="space-y-1.5 pt-1">

                                    <div className="flex flex-wrap gap-1.5">
                                        {msg.suggestedPrompts.map((prompt, pIdx) => (
                                            <button
                                                key={pIdx}
                                                onClick={() => handleSendMessage(prompt)}
                                                disabled={isLoading}
                                                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 shadow-2xs hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-900 transition disabled:opacity-50 text-left"
                                            >
                                                ✨ {prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* User Avatar */}
                        {msg.role === "user" && (
                            <div className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs text-xs font-semibold">
                                HR
                            </div>
                        )}
                    </div>
                ))}

                {/* Loading Indicator */}
                {isLoading && (
                    <div className="flex gap-3.5 justify-start items-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white text-xs font-bold animate-pulse">
                            AI
                        </div>
                        <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500 shadow-xs flex items-center gap-2">
                            <span className="flex gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce"></span>
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]"></span>
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]"></span>
                            </span>
                            <span>Querying database & reasoning...</span>
                        </div>
                    </div>
                )}

                <div ref={chatEndRef} />
            </div>

            {/* Input Bar */}
            <div className="border-t border-gray-200 bg-white p-3 sm:p-4">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSendMessage();
                    }}
                    className="flex items-center gap-2"
                >
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Ask a question or request an action (e.g. 'Create leaves for Rohit from 3rd to 5th Nov')..."
                        disabled={isLoading}
                        className="flex-1 rounded-xl border border-gray-300 py-3 px-4 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                    />

                    <button
                        type="submit"
                        disabled={isLoading || !inputValue.trim()}
                        className="flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
                    >
                        <span className="hidden sm:inline mr-1.5">Send</span>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </button>
                </form>
                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400 px-1">
                    <span>Press Enter to send • Consequential operations require confirmation before database write</span>
                    <span>Neon PostgreSQL • Allowlisted Tools</span>
                </div>
            </div>
        </div>
    );
};

export default AgentChat;
