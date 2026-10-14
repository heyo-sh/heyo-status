"use client";

import { Button, Dialog, Input, Tabs } from "@heyo-sh/heyo-ui";
import { useState, type FormEvent } from "react";

import { defaultStatusBasePath } from "../base-path";
import type { SubscriberMethod } from "../types";

export interface SubscribeDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Methods enabled by the status-page configuration. */
  methods?: readonly SubscriberMethod[];
  /** Mount point of the catch-all status route. Defaults to /api/heyo-status. */
  basePath?: string;
  /** Overrides the base-path-derived public subscription route. */
  apiUrl?: string;
  rssHref?: string;
  atomHref?: string;
  className?: string;
}

/**
 * Client-side public-subscription dialog. It deliberately sends only a target;
 * monitor filters remain optional API functionality for custom integrations.
 *
 * The modal mechanics — focus capture and restoration, Escape, the inert
 * backdrop — belong to heyo-ui's `Dialog`, so this component is only the form
 * and the request it makes.
 */
export function SubscribeDialog({
  open,
  onOpenChange,
  methods = ["email", "rss", "webhook"],
  basePath = defaultStatusBasePath,
  apiUrl = `${basePath}/subscribers`,
  rssHref = `${basePath}/rss.xml`,
  atomHref = `${basePath}/atom.xml`,
  className,
}: SubscribeDialogProps) {
  const availableMethods: readonly SubscriberMethod[] =
    methods.length > 0 ? methods : ["rss"];
  const [method, setMethod] = useState<SubscriberMethod>(availableMethods[0]!);
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const chooseMethod = (next: string) => {
    setMethod(next as SubscriberMethod);
    setMessage(null);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateTarget(method, target);
    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: method, target: target.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Unable to create subscription.");
      }
      setTarget("");
      setMessage(
        response.status === 202
          ? "If needed, check your email to confirm the subscription."
          : "You are subscribed to status updates.",
      );
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unable to create subscription.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(next) => onOpenChange?.(next)} open={open}>
      <Dialog.Content className={className} size="base">
        <Dialog.Header>
          <Dialog.Title>Subscribe to updates</Dialog.Title>
          <Dialog.Description>
            Receive incident and maintenance notifications.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body className="flex flex-col gap-4">
          {availableMethods.length > 1 ? (
            <Tabs
              onValueChange={(value) => chooseMethod(String(value))}
              value={method}
              variant="segmented"
            >
              <Tabs.List
                aria-label="Subscription method"
                items={availableMethods.map((availableMethod) => ({
                  value: availableMethod,
                  label: methodLabel(availableMethod),
                }))}
              />
            </Tabs>
          ) : null}

          {method === "rss" ? (
            <div className="flex flex-col items-start gap-2">
              <p className="m-0 text-sm text-heyo-subtle">
                Follow incident updates in your feed reader.
              </p>
              <div className="flex items-center gap-2">
                {/* `nativeButton={false}`: these are links, and Base UI only
                    keeps native button semantics off a real <button>. */}
                <Button
                  nativeButton={false}
                  render={<a href={rssHref} />}
                  size="sm"
                >
                  RSS feed
                </Button>
                <Button
                  nativeButton={false}
                  render={<a href={atomHref} />}
                  size="sm"
                >
                  Atom feed
                </Button>
              </div>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Input
                autoComplete={method === "email" ? "email" : "url"}
                description={
                  method === "email"
                    ? "We will send a confirmation link before delivering updates."
                    : "We will POST incident and maintenance events to this URL."
                }
                error={error}
                id="heyo-subscription-target"
                label={method === "email" ? "Email address" : "Webhook URL"}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={
                  method === "email"
                    ? "you@example.com"
                    : "https://example.com/status-webhook"
                }
                required
                type={method === "email" ? "email" : "url"}
                value={target}
              />
              {message ? (
                <p aria-live="polite" className="m-0 text-sm text-heyo-success">
                  {message}
                </p>
              ) : null}
              <Button
                loading={submitting}
                shape="block"
                type="submit"
                variant="primary"
              >
                {submitting ? "Subscribing…" : "Subscribe"}
              </Button>
            </form>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog>
  );
}

function methodLabel(method: SubscriberMethod): string {
  return method === "email"
    ? "Email"
    : method === "webhook"
      ? "Webhook"
      : "RSS";
}

function validateTarget(
  method: SubscriberMethod,
  value: string,
): string | null {
  const target = value.trim();
  if (!target) return "A subscription destination is required.";
  if (method === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
      ? null
      : "Enter a valid email address.";
  }
  if (method === "webhook") {
    try {
      const url = new URL(target);
      return url.protocol === "http:" || url.protocol === "https:"
        ? null
        : "Webhook URL must use HTTP(S).";
    } catch {
      return "Enter a valid webhook URL.";
    }
  }
  return null;
}
