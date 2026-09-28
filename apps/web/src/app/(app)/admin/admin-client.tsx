"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { PLANS } from "@/lib/plans";
import {
  addCompany,
  assignSpecialist,
  setCompanyActive,
  setUserBanned,
  setUserPlan,
  setUserRole,
  syncCompanyNow,
  unassignSpecialist,
} from "./actions";

type Result = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = (
    task: () => Promise<Result | { ok: true; data: unknown }>,
    success: string,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0]! : result.error);
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

export function AddCompanyForm() {
  const { pending, run } = useAction();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    run(
      () =>
        addCompany({
          name: String(form.get("name") ?? ""),
          ats: String(form.get("ats") ?? "greenhouse") as "greenhouse",
          boardToken: String(form.get("boardToken") ?? ""),
          website: String(form.get("website") ?? ""),
        }),
      "Company added — first sync queued.",
      () => formElement.reset(),
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_1fr_auto]">
      <Input name="name" placeholder="Company name" required aria-label="Company name" />
      <Select name="ats" aria-label="Job board provider">
        <option value="greenhouse">Greenhouse</option>
        <option value="lever">Lever</option>
        <option value="ashby">Ashby</option>
        <option value="smartrecruiters">SmartRecruiters</option>
      </Select>
      <Input
        name="boardToken"
        placeholder="Board token (e.g. stripe)"
        required
        aria-label="Board token"
      />
      <Input name="website" placeholder="https://company.com" aria-label="Website" />
      <Button type="submit" loading={pending}>
        Add
      </Button>
    </form>
  );
}

export function CompanyActions({ companyId, active }: { companyId: string; active: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => syncCompanyNow({ companyId }), "Sync queued.")}
        aria-label="Sync now"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(
            () => setCompanyActive({ companyId, active: !active }),
            active ? "Paused." : "Resumed.",
          )
        }
      >
        {active ? "Pause" : "Resume"}
      </Button>
    </div>
  );
}

export function UserControls({
  userId,
  role,
  plan,
  banned,
  isSelf,
}: {
  userId: string;
  role: string;
  plan: string;
  banned: boolean;
  isSelf: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Select
        defaultValue={role}
        disabled={pending || isSelf}
        className="h-8 w-32 text-xs"
        aria-label="Role"
        onChange={(event) =>
          run(() => setUserRole({ userId, role: event.target.value as "user" }), "Role updated.")
        }
      >
        <option value="user">User</option>
        <option value="specialist">Specialist</option>
        <option value="admin">Admin</option>
      </Select>
      <Select
        defaultValue={plan}
        disabled={pending}
        className="h-8 w-32 text-xs"
        aria-label="Plan"
        onChange={(event) =>
          run(
            () => setUserPlan({ userId, plan: event.target.value as keyof typeof PLANS }),
            "Plan updated.",
          )
        }
      >
        {Object.values(PLANS).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
      {!isSelf ? (
        <Button
          size="sm"
          variant={banned ? "secondary" : "ghost"}
          className={banned ? undefined : "text-danger"}
          disabled={pending}
          onClick={() => {
            if (!banned && !window.confirm("Ban this user and sign them out everywhere?")) return;
            run(
              () => setUserBanned({ userId, banned: !banned }),
              banned ? "User unbanned." : "User banned.",
            );
          }}
        >
          {banned ? "Unban" : "Ban"}
        </Button>
      ) : null}
    </div>
  );
}

export function AssignForm({
  specialists,
}: {
  specialists: Array<{ id: string; name: string; email: string }>;
}) {
  const { pending, run } = useAction();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    run(
      () =>
        assignSpecialist({
          specialistId: String(form.get("specialistId") ?? ""),
          clientEmail: String(form.get("clientEmail") ?? ""),
        }),
      "Client assigned.",
      () => formElement.reset(),
    );
  }
  if (specialists.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Give a user the Specialist role on the Users tab to start assigning clients.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <Select name="specialistId" aria-label="Specialist">
        {specialists.map((specialist) => (
          <option key={specialist.id} value={specialist.id}>
            {specialist.name} ({specialist.email})
          </option>
        ))}
      </Select>
      <Input
        name="clientEmail"
        type="email"
        placeholder="Client email"
        required
        aria-label="Client email"
      />
      <Button type="submit" loading={pending}>
        Assign
      </Button>
    </form>
  );
}

export function UnassignButton({
  specialistId,
  clientId,
}: {
  specialistId: string;
  clientId: string;
}) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => run(() => unassignSpecialist({ specialistId, clientId }), "Unassigned.")}
    >
      Remove
    </Button>
  );
}
