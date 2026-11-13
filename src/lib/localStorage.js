export function createLocalStorage({ storageKey, seed, clone, onError, supabase = null }) {
  function normalize(parsed) {
    const collections = ["menu", "inventory", "team", "reservations", "orders"];
    if (!parsed || collections.some((key) => !Array.isArray(parsed[key]))) {
      throw new Error("Saved restaurant data is incomplete.");
    }

    return {
      ...clone(seed),
      ...parsed,
      menu: parsed.menu.map((item) => {
        const original = seed.menu.find((entry) => Number(entry.id) === Number(item.id));
        return { ...original, ...item, image: item.image || original?.image || "" };
      }),
      team: [...parsed.team.map((person) => {
        const original = seed.team.find((entry) => Number(entry.id) === Number(person.id));
        return { ...original, ...person, role: person.role === "Server" && original?.role === "Waiter" ? "Waiter" : person.role };
      }), ...(Number(parsed.schemaVersion || 0) < 3 ? seed.team.filter((person) => !parsed.team.some((savedPerson) => Number(savedPerson.id) === Number(person.id))) : [])],
      orders: parsed.orders.map((order) => ({ ...seed.orders.find((entry) => Number(entry.id) === Number(order.id)), ...order })),
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      seenReservationIds: Array.isArray(parsed.seenReservationIds) ? parsed.seenReservationIds : [],
      timeEntries: Array.isArray(parsed.timeEntries) ? parsed.timeEntries : [],
      leaveRequests: Array.isArray(parsed.leaveRequests) && parsed.leaveRequests.length ? parsed.leaveRequests : clone(seed.leaveRequests || []),
      replacementRequests: Array.isArray(parsed.replacementRequests) && parsed.replacementRequests.length ? parsed.replacementRequests : clone(seed.replacementRequests || []),
      expenses: Array.isArray(parsed.expenses) && parsed.expenses.length ? parsed.expenses : clone(seed.expenses || []),
      complaints: Array.isArray(parsed.complaints) && parsed.complaints.length ? parsed.complaints : clone(seed.complaints || []),
      wagePayments: Array.isArray(parsed.wagePayments) && parsed.wagePayments.length ? parsed.wagePayments : clone(seed.wagePayments || [])
    };
  }

  async function save(state) {
    try {
      state.schemaVersion = 3;
      window.localStorage.setItem(storageKey, JSON.stringify(state));

      if (supabase) {
        const { error } = await supabase
          .from("restaurant_state")
          .upsert({ id: storageKey, data: state, updated_at: new Date().toISOString() });
        if (error) throw error;
      }
    } catch (error) {
      console.error("Could not save restaurant data.", error);
      onError(supabase
        ? "Saved locally, but Supabase sync failed. Check the database table and policies."
        : "Changes could not be saved in this browser. Export a backup to keep your data.");
    }
  }

  function load() {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return clone(seed);

      return normalize(JSON.parse(saved));
    } catch (error) {
      console.error("Could not load saved restaurant data.", error);
      onError("Saved data could not be read. Showing the demo data instead.");
      return clone(seed);
    }
  }

  async function loadRemote() {
    if (!supabase) return null;

    const { data, error } = await supabase
      .from("restaurant_state")
      .select("data")
      .eq("id", storageKey)
      .maybeSingle();
    if (error) throw error;
    return data?.data ? normalize(data.data) : null;
  }

  return { load, loadRemote, save };
}
