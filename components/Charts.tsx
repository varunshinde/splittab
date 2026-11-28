"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

export const CHART_COLORS = ["#1cc29f", "#ff652f", "#0891b2", "#f59e0b", "#7c3aed", "#16a34a", "#db2777", "#65a30d"];

const money = (v: unknown) => `$${Number(v ?? 0).toFixed(2)}`;

/** Donut chart (category breakdown, who paid the most, ...). */
export function DonutChart({ data, title }: { data: { name: string; value: number }[]; title?: string }) {
  const clean = data.filter((d) => d.value > 0);
  if (clean.length === 0) return null;
  return (
    <div className="h-72">
      {title && <h3 className="mb-2 font-medium">{title}</h3>}
      <ResponsiveContainer width="100%" height="90%">
        <PieChart>
          <Pie data={clean} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={2} strokeWidth={0}>
            {clean.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Legend />
          <Tooltip formatter={(v) => money(v)} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly spending bars. `data` is [{ month: "Mar 2026", amount }]. */
export function MonthlyBars({ data, title }: { data: { month: string; amount: number }[]; title?: string }) {
  if (data.length === 0) return null;
  return (
    <div className="h-72">
      {title && <h3 className="mb-2 font-medium">{title}</h3>}
      <ResponsiveContainer width="100%" height="90%">
        <BarChart data={data}>
          <XAxis dataKey="month" tick={{ fontSize: 12 }} interval={0} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 50 : 30} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v}`} width={48} />
          <Tooltip formatter={(v) => money(v)} />
          <Bar dataKey="amount" fill="#1cc29f" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Group charts tab composition: monthly trend, category donut, who paid. */
export function SpendingCharts({ byMonth, byCategory, byPayer }: {
  byMonth: { month: string; amount: number }[];
  byCategory: { name: string; value: number }[];
  byPayer: { name: string; value: number }[];
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <MonthlyBars data={byMonth} title="Spending by month" />
      <DonutChart data={byCategory} title="Category breakdown" />
      <DonutChart data={byPayer} title="Who paid the most" />
    </div>
  );
}
