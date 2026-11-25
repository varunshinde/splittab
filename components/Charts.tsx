"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"];
export function SpendingCharts({ byDate, byCategory }: { byDate: { date: string; amount: number }[]; byCategory: { name: string; value: number }[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="h-72"><h3 className="mb-2 font-medium">Spending over time</h3>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={byDate}><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="amount" stroke="#2563eb" /></LineChart>
        </ResponsiveContainer></div>
      <div className="h-72"><h3 className="mb-2 font-medium">Category breakdown</h3>
        <ResponsiveContainer width="100%" height="90%">
          <PieChart><Pie data={byCategory} dataKey="value" nameKey="name" label>{byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Legend /><Tooltip /></PieChart>
        </ResponsiveContainer></div>
    </div>
  );
}
