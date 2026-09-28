"use strict";

import { supabase } from "./supabase.js";
import { state } from "./state.js";

export async function loadDatabase() {

    const { data: users, error: usersError } =
        await supabase.from('users').select('*');

    const { data: teams, error: teamsError } =
        await supabase.from('teams').select('*');

    const { data: projectManagers, error: pmError } =
        await supabase.from('project_managers').select('*');

    const { data: tasks, error: tasksError } =
        await supabase.from('tasks').select('*');

    const { data: departments, error: depError } =
        await supabase.from('departments').select('*');

    const { data: activityLog, error: logError } =
        await supabase
            .from('activity_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(30);

    if (usersError) console.error(usersError);
    if (teamsError) console.error(teamsError);
    if (pmError) console.error(pmError);
    if (tasksError) console.error(tasksError);
    if (depError) console.error(depError);
    if (logError) console.error(logError);

    const mappedUsers = mapUsers(users);
    const mappedTeams = mapTeams(teams);
    const mappedTasks = mapTasks(tasks);
    const mappedLog = mapActivityLog(activityLog);

    state.users = mappedUsers;
    state.teams = mappedTeams;
    state.projectManagers = projectManagers || [];
    state.tasks = mappedTasks;
    state.departments = departments || [];
    state.activityLog = mappedLog;

    return {
        users: mappedUsers,
        teams: mappedTeams,
        tasks: mappedTasks,
        projectManagers: projectManagers || [],
        departments: departments || [],
        activityLog: mappedLog
    };
}

/* ============================================================
    Supabase columns are snake_case (team_id, member_ids,
    assignee_type, assignee_id, project_manager_id,
    update_requested). The rest of the app (common.js, admin.js,
    employee.js) reads/writes camelCase properties, so every load
    has to translate one to the other.
   ============================================================ */

function mapUsers(users) {
    return (users || []).map((u) => ({
        ...u,
        teamId: u.teamId,
    }));
}

function mapTeams(teams) {
    return (teams || []).map((t) => ({
        ...t,
        member_ids: t.member_ids || [],
    }));
}

function mapTasks(tasks) {
    return (tasks || []).map((t) => ({
        ...t,
        assigneeType: t.assignee_type,
        assigneeId: t.assignee_id,
        projectManagerId: t.project_manager_id,
        updateRequested: t.update_requested,
        files: t.files || [],
        reports: t.reports || [],
    }));
}

function mapActivityLog(rows) {
    return (rows || []).map((a) => ({
        ...a,
        taskTitle: a.task_title,
        actorId: a.actor_id,
        actorName: a.actor_name,
        actorRole: a.actor_role,
        projectManagerId: a.project_manager_id,
    }));
}

export async function loadData() {

    const { data: users } =
        await supabase.from("users").select("*");

    const { data: tasks } =
        await supabase.from("tasks").select("*");

    const { data: teams } =
        await supabase.from("teams").select("*");

    const { data: departments } =
        await supabase.from("departments").select("*");

    const { data: projectManagers } =
        await supabase.from("project_managers").select("*");

    const { data: activityLog } =
        await supabase
            .from("activity_log")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(30);

    const mappedUsers = mapUsers(users);
    const mappedTeams = mapTeams(teams);
    const mappedTasks = mapTasks(tasks);
    const mappedLog = mapActivityLog(activityLog);

    state.users = mappedUsers;
    state.tasks = mappedTasks;
    state.teams = mappedTeams;
    state.departments = departments || [];
    state.projectManagers = projectManagers || [];
    state.activityLog = mappedLog;

    return {
        users: mappedUsers,
        teams: mappedTeams,
        tasks: mappedTasks,
        projectManagers: projectManagers || [],
        departments: departments || [],
        activityLog: mappedLog
    };

}

export function daysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

export function today() {
    return new Date().toISOString().slice(0, 10);
}