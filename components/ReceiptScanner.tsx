"use client";

import { useState } from "react";
import { parseReceiptText, type OcrSuggestion } from "@/lib/ocr-parse";
import { formatMoney } from "@/lib/format";
import { addOcrItemsForm } from "@/app/actions";

/* Receipt scanning with Tesseract.js — the OCR runs ENTIRELY in the
   browser (WASM, assets served same-origin from /ocr/). The receipt image
   is fetched from our own private receipt route and never sent to any
   third-party OCR service. What comes back is a list of SUGGESTIONS the
   user reviews and edits before anything is saved. */

type ScanState =
  | { phase: "idle" }
  | { phase: "working"; label: string; pct: number }
  | { phase: "review"; items: OcrSuggestion[]; totalInCents: number | null }
  | { phase: "empty" }
  | { phase: "error"; message: string };

const STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "Loading the OCR engine",
  "initializing tesseract": "Starting the OCR engine",
  "loading language traineddata": "Loading English language data",
  "initializing api": "Preparing the scan",
  "recognizing text": "Reading the receipt",
};

export function ReceiptScanner({ expenseId, receiptId, currency }: { expenseId: string; receiptId: string; currency: string }) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });

  async function scan() {
    setState({ phase: "working", label: "Fetching the receipt", pct: 0 });
    type OcrWorker = { recognize: (img: Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
    let worker: OcrWorker | null = null;
    try {
      const res = await fetch(`/api/receipts/${receiptId}`);
      if (!res.ok) throw new Error("fetch_failed");
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) {
        setState({ phase: "error", message: "Scanning works on photo receipts (JPG/PNG). This receipt is a PDF — add its items manually below." });
        return;
      }
      const blob = await res.blob();
      const Tesseract = await import("tesseract.js");
      worker = (await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/core",
        langPath: "/ocr/lang",
        gzip: true,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          setState({ phase: "working", label: STATUS_LABELS[m.status] ?? "Scanning", pct: Math.round((m.progress ?? 0) * 100) });
        },
      })) as unknown as OcrWorker;
      const { data } = await worker.recognize(blob);
      const parsed = parseReceiptText(data.text);
      if (parsed.items.length === 0) {
        setState({ phase: "empty" });
      } else {
        setState({ phase: "review", items: parsed.items, totalInCents: parsed.totalInCents });
      }
    } catch {
      setState({ phase: "error", message: "The scan didn't work this time. A straight-on, well-lit photo works best — or add the items manually below." });
    } finally {
      await worker?.terminate().catch(() => {});
    }
  }

  if (state.phase === "review") {
    const itemsSum = state.items.reduce((s, i) => s + i.amountInCents, 0);
    return (
      <form action={addOcrItemsForm} className="mt-3 space-y-2">
        <input type="hidden" name="expenseId" value={expenseId} />
        <div className="text-sm font-medium">Review the scanned items — fix anything the scan misread:</div>
        {state.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="checkbox" name="includeIdx" value={i} defaultChecked className="h-4 w-4 accent-[#1cc29f]" />
            <input name="itemDesc" defaultValue={item.description} maxLength={200} className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand" />
            <input name="itemAmount" type="number" step="0.01" min="0" defaultValue={(item.amountInCents / 100).toFixed(2)} className="w-24 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand" />
          </div>
        ))}
        <p className="text-xs text-neutral-500">
          Items found: {formatMoney(itemsSum, currency)}
          {state.totalInCents !== null && <> · the bill&apos;s printed total reads {formatMoney(state.totalInCents, currency)} — the difference is usually tax and tip, which the itemization splits equally.</>}
        </p>
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Add selected items</button>
          <button type="button" onClick={() => setState({ phase: "idle" })} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-600 ring-1 ring-neutral-300 hover:bg-app">Discard scan</button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={scan}
        disabled={state.phase === "working"}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-wait disabled:opacity-60"
      >
        {state.phase === "working" ? `${state.label}… ${state.pct}%` : "Scan receipt for items"}
      </button>
      <span className="ml-2 text-xs text-neutral-400">Free, on-device OCR — the photo never leaves your browser for scanning.</span>
      {state.phase === "empty" && <p className="mt-2 text-sm text-neutral-500">No line items found in that photo. A straighter, well-lit shot usually works — or add the items manually below.</p>}
      {state.phase === "error" && <p className="mt-2 text-sm text-red-600">{state.message}</p>}
    </div>
  );
}
