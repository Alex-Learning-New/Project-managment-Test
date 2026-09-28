"use strict";

import { supabase } from "./supabase.js";
import { getSessionUserId, setSession, pageForRole } from "./common.js";

/* ============================================================
    login.js — sign-in page (index.html)
    Validates credentials, then sends the user to the dashboard
    matching their role. Admins and employees live in the `users`
    table; project managers live in the separate `project_managers`
    table, so both are checked.
   ============================================================ */

/** Looks up a signed-in id in `users` first, then `project_managers`.
 *  Returns { role } or null. */
async function findRoleById(id) {
    const { data: user } = await supabase
        .from("users")
        .select("id, role")
        .eq("id", id)
        .single();

    if (user) return { role: user.role };

    const { data: pm } = await supabase
        .from("project_managers")
        .select("id")
        .eq("id", id)
        .single();

    if (pm) return { role: "project-manager" };

    return null;
}

// Already signed in? Skip the form.
(async function redirectIfSignedIn() {

    const sessionId = getSessionUserId();

    if (!sessionId) return;

    const person = await findRoleById(sessionId);

    if (person) {
        window.location.replace(pageForRole(person.role));
    }

})();

document
    .getElementById("login-form")
    .addEventListener("submit", async function (e) {
        e.preventDefault();

        const id = document.getElementById("login-id").value.trim();

        const pass = document.getElementById("login-pass").value;

        const errEl = document.getElementById("login-error");

        const { data: user } = await supabase
            .from("users")
            .select("*")
            .eq("id", id)
            .eq("password", pass)
            .single();

        let role = user?.role || null;
        let personId = user?.id || null;

        if (!personId) {
            const { data: pm } = await supabase
                .from("project_managers")
                .select("*")
                .eq("id", id)
                .eq("password", pass)
                .single();

            if (pm) {
                role = "project-manager";
                personId = pm.id;
            }
        }

        if (!personId) {
            errEl.textContent = "ID or password not recognized.";
            return;
        }

        errEl.textContent = "";

        setSession(personId);

        window.location.href = pageForRole(role);
    });
