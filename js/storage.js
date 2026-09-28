"use strict";

import { supabase } from "./supabase.js";

/* ============================================================
     storage.js — every file upload in TaskFlow goes through here.

     Files live in ONE private Supabase Storage bucket, organised as
     tasks/<taskId>/...        attachments, progress updates, reports
     worksheets/<userId>/...   daily worksheet files
     The bucket is private, so there are no permanent public links:
     a file is only opened by asking Supabase for a signed URL that
     expires after a few minutes. Which screens show the link (admin,
     the project manager, the assigned employee) is decided by the
     dashboards themselves.
   ============================================================ */

export const FILES_BUCKET = "taskflow-files";
export const LEGACY_BUCKET = "worksheet-files"; // older worksheet uploads
export const MAX_FILE_MB = 10;

function localDate(d = new Date()) {
     const p = (n) => String(n).padStart(2, "0");
     return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function safeName(name) {
     return name.replace(/[^\w.\-]+/g, "_");
}

/** Uploads File objects into `folder` and returns the records to store in
 *  a `files` column: [{ name, path, bucket, size, type, date }].
 *  Throws (with a readable message) if any upload fails. */
export async function uploadFiles(files, folder) {
     const stored = [];

     for (const f of files) {
          const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const path = `${folder}/${unique}-${safeName(f.name)}`;

          const { error } = await supabase.storage
               .from(FILES_BUCKET)
               .upload(path, f, { upsert: false, contentType: f.type || undefined });

          if (error) throw new Error(`Couldn't upload ${f.name}: ${error.message}`);

          stored.push({
               name: f.name,
               path,
               bucket: FILES_BUCKET,
               size: f.size,
               type: f.type || "",
               date: localDate(),
               uploadedAt: new Date().toISOString()
          });
     }

     return stored;
}

/** Temporary link to a stored file (default: valid for 5 minutes). */
export async function signedUrl(file, seconds = 300) {
     const bucket = file.bucket || LEGACY_BUCKET;
     const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(file.path, seconds);

     if (error) throw new Error(`Couldn't open ${file.name || "file"}: ${error.message}`);
     return data.signedUrl;
}

/** Opens a stored file in a new tab. The tab is opened straight away (so
 *  popup blockers allow it) and pointed at the signed link once ready. */
export async function openStoredFile(file) {
     const win = window.open("", "_blank");
     try {
          const url = await signedUrl(file);
          if (win) win.location.href = url;
          else window.location.href = url;
     } catch (e) {
          if (win) win.close();
          throw e;
     }
}