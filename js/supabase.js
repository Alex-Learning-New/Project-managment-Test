import { createClient }
    from 'https://esm.sh/@supabase/supabase-js'

const supabaseUrl =
    'https://unuetcavrxzmwtaojbwj.supabase.co'

const supabaseKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudWV0Y2F2cnh6bXd0YW9qYndqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMzIxMDgsImV4cCI6MjEwNTkwODEwOH0.xjlMFDk0ETlAjOhl-jUyfaIYXbglvT2l8fazUFnaEiM'

export const supabase =
    createClient(
        supabaseUrl,
        supabaseKey
    )

export async function getUsers() {

    const { data, error } =
        await supabase
            .from("users")
            .select("*");

    return data;
}

export async function addUser(user) {

    const { data, error } =
        await supabase
            .from("users")
            .insert([user]);

    return data;
}

export async function deleteUser(id) {

    const { error } =
        await supabase
            .from("users")
            .delete()
            .eq("id", id);
}

export async function updateUser(id, updates) {

    const { error } =
        await supabase
            .from("users")
            .update(updates)
            .eq("id", id);
}

export async function getTasks() {

    const { data } =
        await supabase
            .from("tasks")
            .select("*");

    return data;
}

export async function addTask(task) {

    const { data } =
        await supabase
            .from("tasks")
            .insert([task]);

    return data;
}

export async function updateTask(id, updates) {

    await supabase
        .from("tasks")
        .update(updates)
        .eq("id", id);
}

export async function deleteTask(id) {

    await supabase
        .from("tasks")
        .delete()
        .eq("id", id);
}

export async function getTeams() {

    const { data } =
        await supabase
            .from("teams")
            .select("*");

    return data;
}

export async function getDepartments() {

    const { data } =
        await supabase
            .from("departments")
            .select("*");

    return data;
}