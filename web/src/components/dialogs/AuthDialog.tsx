"use client";

/**
 * Log in, or create an account as a student or a teacher. Opened with openAuth()
 * (state/dialogs.ts), which resolves once the user is logged in or gives up.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { button, DIALOG_ROW, field, MUTED_P, SEGMENTED } from "@/components/ui/classes";
import { useStore } from "@/hooks/useStore";
import { credentialsSchema, type Credentials } from "@/lib/credentials";
import { api, type Role } from "@/services/api";
import { authStore } from "@/state/dialogs";
import { toast } from "@/state/toast";
import { FieldError } from "./FieldError";
import { Modal } from "./Modal";
import type { z } from "@/lib/zod";

type Tab = "login" | "register";

const LABEL = "my-3 flex flex-col gap-1.5 text-[13px] text-muted";
const FIELD = `${field(true)} w-full`;
const EMPTY = { username: "", password: "" };

export function AuthDialog() {
  const request = useStore(authStore, null);
  const [tab, setTab] = useState<Tab>("login");
  const [role, setRole] = useState<Role>("student");
  // react-hook-form keeps the fields, checked by the zod schema of lib/credentials.ts
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof credentialsSchema>, unknown, Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: EMPTY,
  });
  const close = () => {
    if (!request) return;
    authStore.set(null);
    request.resolve(!!api.currentUser());
  };
  const account = useMutation({
    mutationFn: ({ username, password }: Credentials) =>
      tab === "login" ? api.login(username, password) : api.register(username, password, role),
    onSuccess: (notice, { username }) => {
      const user = api.currentUser()?.username ?? username;
      close();
      toast(
        notice || (tab === "login" ? `Welcome back, ${user}` : `Account created. Hi, ${user}!`),
        notice ? "error" : "ok",
      );
    },
  });
  const { reset: forgetError } = account;
  // A new request starts with an empty form (the tab and role stay as they were)
  useEffect(() => {
    if (!request) return;
    reset(EMPTY);
    forgetError();
  }, [request, reset, forgetError]);

  const chooseTab = (t: Tab) => {
    setTab(t);
    account.reset();
  };

  return (
    <Modal open={!!request} onClose={close} label="Your account">
      <form noValidate onSubmit={handleSubmit((credentials) => account.mutate(credentials))}>
        <h2 className="mb-3 text-[17px] font-bold">Your account</h2>
        {request?.reason ? <p className={MUTED_P}>{request.reason}</p> : null}
        <p className={MUTED_P}>Your account and melodies are kept on the classroom board and in the cloud.</p>
        <div className={SEGMENTED}>
          <button
            type="button"
            className={button("plain", "segment")}
            aria-pressed={tab === "login"}
            onClick={() => chooseTab("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={button("plain", "segment")}
            aria-pressed={tab === "register"}
            onClick={() => chooseTab("register")}
          >
            Create account
          </button>
        </div>
        {tab === "register" ? (
          <div className={`${SEGMENTED} mt-2.5`}>
            <button
              type="button"
              className={button("plain", "segment")}
              aria-pressed={role === "student"}
              onClick={() => setRole("student")}
            >
              I&apos;m a student
            </button>
            <button
              type="button"
              className={button("plain", "segment")}
              aria-pressed={role === "teacher"}
              onClick={() => setRole("teacher")}
            >
              I&apos;m a teacher
            </button>
          </div>
        ) : null}
        <label className={LABEL}>
          Username
          <input
            className={FIELD}
            {...register("username")}
            aria-invalid={errors.username ? true : undefined}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        <FieldError message={errors.username?.message} />
        <label className={LABEL}>
          Password
          <input
            className={FIELD}
            type="password"
            {...register("password")}
            aria-invalid={errors.password ? true : undefined}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
          />
        </label>
        <FieldError message={errors.password?.message} />
        <p className="mt-1 min-h-[1.2em] text-[13px] text-danger" role="alert">
          {account.error?.message}
        </p>
        <div className={DIALOG_ROW}>
          <button type="button" className={button()} onClick={close}>
            Cancel
          </button>
          <button type="submit" className={button("primary")} disabled={account.isPending}>
            {tab === "login" ? "Log in" : "Create account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
