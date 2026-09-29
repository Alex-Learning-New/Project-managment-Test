// Supabase Edge Function: notify-pm
// Emails a project's project manager when an employee updates its progress.
//
// Secrets (set once, in Dashboard → Edge Functions → Secrets or via CLI):
//   RESEND_API_KEY   your Resend API key
//   MAIL_FROM        e.g. TaskFlow <notifications@yourdomain.com>   (optional)
//   APP_URL          e.g. https://yourapp.com/pm.html               (optional, adds an "Open" button)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy:  supabase functions deploy notify-pm --no-verify-jwt
// (JWT check must be off, otherwise the browser's CORS preflight is rejected.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  "in-progress": "In progress",
  review: "In review",
  done: "Done",
};

function fmtDue(d?: string) {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00Z`);
  return isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");

/* ---------- email template (table layout + inline styles for email clients) ---------- */
function emailHtml(o: {
  who: string;
  title: string;
  source: string;
  oldP: number;
  newP: number;
  note: string;
  status: string;
  due: string;
  priority: string;
  appUrl?: string;
}) {
  const delta = o.newP - o.oldP;
  const deltaTxt = `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`;
  const deltaBg = delta >= 0 ? "#e4f6e9" : "#ffe8eb";
  const deltaFg = delta >= 0 ? "#248a3d" : "#d70015";
  const done = o.newP >= 100;
  const barFilled = Math.max(0, Math.min(100, o.newP));
  const barRest = 100 - barFilled;
  const initial = esc(o.who.trim().charAt(0).toUpperCase() || "?");
  const font = `-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Progress update</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
  ${esc(o.who)} moved “${esc(o.title)}” from ${o.oldP}% to ${o.newP}%.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;">
<tr><td align="center" style="padding:32px 12px;">

  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:${font};">

    <!-- brand -->
    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:28px;height:28px;background:#0071e3;border-radius:8px;text-align:center;">
          <div style="width:10px;height:10px;background:#ffffff;border-radius:3px;margin:0 auto;line-height:10px;font-size:0;">&nbsp;</div>
        </td>
        <td style="padding-left:10px;font-size:15px;font-weight:700;color:#1d1d1f;letter-spacing:-0.01em;">TaskFlow</td>
      </tr></table>
    </td></tr>

    <!-- card -->
    <tr><td style="background:#ffffff;border-radius:20px;border:1px solid #e5e5ea;overflow:hidden;">

      <!-- hero -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td bgcolor="#0071e3" style="background:#0071e3;background-image:linear-gradient(135deg,#0a84ff 0%,#5e5ce6 60%,#bf5af2 100%);padding:28px 32px;">
          <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.8);">Progress update</div>
          <div style="font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;margin-top:8px;letter-spacing:-0.02em;">${esc(o.title)}</div>
        </td></tr>
      </table>

      <!-- who -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:24px 32px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:40px;height:40px;background:#e8f2ff;border-radius:20px;text-align:center;font-size:16px;font-weight:700;color:#0058b0;">${initial}</td>
            <td style="padding-left:12px;font-size:15px;line-height:1.4;color:#1d1d1f;">
              <b>${esc(o.who)}</b> updated this project<br>
              <span style="font-size:13px;color:#6e6e73;">via ${esc(o.source)}</span>
            </td>
          </tr></table>
        </td></tr>
      </table>

      <!-- progress -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:20px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;border-radius:14px;">
            <tr><td style="padding:18px 20px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="font-size:13px;color:#6e6e73;">Progress</td>
                <td align="right">
                  <span style="display:inline-block;background:${deltaBg};color:${deltaFg};font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;">${deltaTxt}</span>
                </td>
              </tr></table>
              <div style="font-size:32px;line-height:1.1;font-weight:700;color:#1d1d1f;margin-top:6px;letter-spacing:-0.02em;">
                <span style="color:#8e8e93;font-weight:500;">${o.oldP}%</span>
                <span style="color:#8e8e93;font-weight:400;">&nbsp;&rarr;&nbsp;</span>
                <span style="color:${done ? "#248a3d" : "#0071e3"};">${o.newP}%</span>
              </div>
            </td></tr>
            <tr><td style="padding:8px 20px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:999px;overflow:hidden;background:#e5e5ea;">
                <tr>
                  ${barFilled > 0 ? `<td width="${barFilled}%" height="10" bgcolor="${done ? "#30d158" : "#0071e3"}" style="background:${done ? "#30d158" : "#0071e3"};height:10px;font-size:0;line-height:0;">&nbsp;</td>` : ""}
                  ${barRest > 0 ? `<td width="${barRest}%" height="10" style="height:10px;font-size:0;line-height:0;">&nbsp;</td>` : ""}
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
      </table>

      <!-- details -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:12px 32px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="padding:0 8px 0 0;vertical-align:top;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8e8e93;">Status</div>
                <div style="font-size:14px;font-weight:600;color:#1d1d1f;margin-top:4px;">${esc(o.status)}</div>
              </td>
              <td width="33%" style="padding:0 8px;vertical-align:top;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8e8e93;">Due</div>
                <div style="font-size:14px;font-weight:600;color:#1d1d1f;margin-top:4px;">${esc(o.due)}</div>
              </td>
              <td width="33%" style="padding:0 0 0 8px;vertical-align:top;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8e8e93;">Priority</div>
                <div style="font-size:14px;font-weight:600;color:#1d1d1f;margin-top:4px;">${esc(o.priority)}</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      ${
        o.note
          ? `
      <!-- note -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:20px 32px 4px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#8e8e93;margin-bottom:8px;">Note from ${esc(o.who.split(" ")[0])}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="width:3px;background:#0071e3;border-radius:3px;font-size:0;">&nbsp;</td>
            <td style="padding:2px 0 2px 14px;font-size:14.5px;line-height:1.6;color:#424245;white-space:pre-wrap;">${esc(o.note)}</td>
          </tr></table>
        </td></tr>
      </table>`
          : ""
      }

      ${
        o.appUrl
          ? `
      <!-- button -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:28px 32px 8px;">
          <a href="${esc(o.appUrl)}" style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:12px;">View project &rarr;</a>
        </td></tr>
      </table>`
          : ""
      }

      <div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>
    </td></tr>

    <!-- footer -->
    <tr><td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:#8e8e93;">
      You’re receiving this because you manage this project in TaskFlow.<br>
      This is an automated message, please don’t reply.
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

function emailText(o: {
  who: string;
  title: string;
  source: string;
  oldP: number;
  newP: number;
  note: string;
  appUrl?: string;
}) {
  return [
    `Progress update: ${o.title}`,
    ``,
    `${o.who} updated this project (via ${o.source}).`,
    `Progress: ${o.oldP}% -> ${o.newP}%`,
    o.note ? `\nNote:\n${o.note}` : "",
    o.appUrl ? `\nView project: ${o.appUrl}` : "",
    ``,
    `-- TaskFlow (automated message)`,
  ].join("\n");
}

/* ---------- handler ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });

  try {
    const { taskId, employeeId, oldProgress, newProgress, note, source } =
      await req.json();
    if (!taskId) return json({ error: "taskId is required" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Everything important comes from the database, not from the request.
    const { data: project } = await sb
      .from("tasks")
      .select("id, title, progress, status, due, priority, project_manager_id")
      .eq("id", taskId)
      .single();
    if (!project) return json({ error: "Project not found" }, 404);
    if (!project.project_manager_id)
      return json({ error: "Project has no project manager" }, 400);

    // Only send if the saved progress really matches what the caller says
    // (stops the endpoint being used to send arbitrary mail).
    if (Number(project.progress) !== Number(newProgress)) {
      return json(
        { error: "Progress in request doesn't match the saved project" },
        409,
      );
    }

    const { data: pm } = await sb
      .from("project_managers")
      .select("*")
      .eq("id", project.project_manager_id)
      .single();
    if (!pm?.email)
      return json(
        { error: "The project manager has no email address on file" },
        400,
      );

    const { data: emp } = employeeId
      ? await sb.from("users").select("name").eq("id", employeeId).single()
      : { data: null };
    const who = emp?.name || "An employee";

    const details = {
      who,
      title: project.title as string,
      source: (source as string) || "project update",
      oldP: Number(oldProgress) || 0,
      newP: Number(newProgress) || 0,
      note: String(note || "").slice(0, 2000),
      appUrl: Deno.env.get("APP_URL") || undefined,
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "TaskFlow <onboarding@resend.dev>",
        to: [pm.email],
        subject: `${who} updated “${project.title}” to ${details.newP}%`,
        html: emailHtml({
          ...details,
          status: STATUS_LABEL[project.status] || cap(project.status),
          due: fmtDue(project.due),
          priority: cap(project.priority),
        }),
        text: emailText(details),
      }),
    });

    if (!res.ok)
      return json({ error: `Email provider error: ${await res.text()}` }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
