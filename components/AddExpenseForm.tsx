"use client";
import { useMemo, useState } from "react";
import { addExpenseForm } from "@/app/actions";
import { Avatar } from "./Avatar";
import { Button, Input, Label, selectClass } from "./ui/ui";

interface Person { id: string; name: string; email?: string; isPlaceholder?: boolean }
interface GroupOpt { id: string; name: string; baseCurrency: string; members: Person[] }

export function AddExpenseForm({
  me, friends, groups, preselectedFriendId,
}: {
  me: Person;
  friends: Person[];
  groups: GroupOpt[];
  preselectedFriendId?: string;
}) {
  const [context, setContext] = useState<"friends" | "group">("friends");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [friendIds, setFriendIds] = useState<string[]>(preselectedFriendId ? [preselectedFriendId] : []);
  const [paidById, setPaidById] = useState(me.id);
  const [participants, setParticipants] = useState<string[] | null>(null); // null = "everyone involved"

  const group = groups.find((g) => g.id === groupId);
  const involved: Person[] = useMemo(() => {
    if (context === "group") return group?.members ?? [];
    const chosen = friends.filter((f) => friendIds.includes(f.id));
    return [me, ...chosen];
  }, [context, group, friendIds, friends, me]);
  const splitWith = participants ?? involved.map((p) => p.id);
  const payerOptions = involved.length > 0 ? involved : [me];
  const effectivePayer = payerOptions.some((p) => p.id === paidById) ? paidById : me.id;

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <form action={addExpenseForm} className="space-y-4">
      <input type="hidden" name="context" value={context} />
      <div>
        <Label>Split with</Label>
        <div className="mb-2 flex gap-2">
          <button type="button" onClick={() => { setContext("friends"); setParticipants(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${context === "friends" ? "bg-brand text-white" : "border border-neutral-300 bg-white"}`}>Friends</button>
          <button type="button" onClick={() => { setContext("group"); setParticipants(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${context === "group" ? "bg-brand text-white" : "border border-neutral-300 bg-white"}`}>A group</button>
        </div>
        {context === "group" ? (
          groups.length === 0 ? (
            <p className="text-sm text-neutral-500">You have no groups yet — create one from the Groups page, or split with friends instead.</p>
          ) : (
            <select name="groupId" value={groupId} onChange={(e) => { setGroupId(e.target.value); setParticipants(null); }} className={`${selectClass} w-full`}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )
        ) : (
          <div className="space-y-1.5">
            {friends.length === 0 && <p className="text-sm text-neutral-500">No friends yet — add one by email from the Friends page first.</p>}
            {friends.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:border-brand">
                <input type="checkbox" checked={friendIds.includes(f.id)} onChange={() => { setFriendIds(toggleIn(friendIds, f.id)); setParticipants(null); }} className="h-4 w-4 accent-[#1cc29f]" />
                <Avatar name={f.name} seed={f.email} size="sm" />
                <span className="font-medium">{f.name}</span>
                <span className="truncate text-xs text-neutral-500">{f.email}{f.isPlaceholder ? " · invited" : ""}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div><Label htmlFor="description">Description</Label><Input id="description" name="description" required maxLength={200} placeholder="Dinner, rent, taxi…" /></div>

      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="amount">Amount</Label><Input id="amount" name="amount" type="number" step="0.01" min="0.01" required placeholder="0.00" /></div>
        <div><Label htmlFor="currency">Currency</Label><Input id="currency" name="currency" defaultValue="USD" maxLength={3} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="paidById">Paid by</Label>
          <select id="paidById" name="paidById" value={effectivePayer} onChange={(e) => setPaidById(e.target.value)} className={`${selectClass} w-full`}>
            {payerOptions.map((p) => <option key={p.id} value={p.id}>{p.id === me.id ? "You" : p.name}</option>)}
          </select></div>
        <div><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      </div>
      <div><Label htmlFor="category">Category</Label><Input id="category" name="category" defaultValue="General" maxLength={50} /></div>

      <div>
        <Label>Split equally between</Label>
        <div className="space-y-1.5">
          {involved.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:border-brand">
              <input type="checkbox" name="participantIds" value={p.id} checked={splitWith.includes(p.id)}
                onChange={() => setParticipants(toggleIn(splitWith, p.id))} className="h-4 w-4 accent-[#1cc29f]" />
              <Avatar name={p.name} seed={p.email} size="sm" />
              <span className="font-medium">{p.id === me.id ? "You" : p.name}</span>
              {p.id === effectivePayer && <span className="text-xs text-neutral-400">(paid)</span>}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-neutral-400">Uncheck the payer to record an expense they covered entirely for others.</p>
      </div>

      <div><Label htmlFor="notes">Notes (optional)</Label><Input id="notes" name="notes" maxLength={1000} /></div>
      <Button type="submit" className="w-full py-2.5">Save expense</Button>
    </form>
  );
}
