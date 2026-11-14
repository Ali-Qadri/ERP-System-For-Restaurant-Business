const ROLE_READ_TABLES = {
  staff_shared: ["dining_tables", "menu_categories", "menu_items", "orders", "order_items", "reservations", "notifications", "complaints"],
  manager: ["dining_tables", "menu_categories", "menu_items", "menu_item_ingredients", "orders", "order_items", "reservations", "employees", "shift_assignments", "time_entries", "leave_requests", "replacement_requests", "wage_payments", "suppliers", "inventory_items", "inventory_movements", "payments", "expenses", "notifications", "complaints", "audit_logs"],
  owner: ["dining_tables", "menu_categories", "menu_items", "menu_item_ingredients", "orders", "order_items", "reservations", "employees", "shift_assignments", "time_entries", "leave_requests", "replacement_requests", "wage_payments", "suppliers", "inventory_items", "inventory_movements", "payments", "expenses", "notifications", "complaints", "audit_logs"]
};

const emptyState = () => ({ menu: [], inventory: [], team: [], diningTables: [], reservations: [], orders: [], leaveRequests: [], replacementRequests: [], expenses: [], complaints: [], wagePayments: [], timeEntries: [], notifications: [], payments: [], suppliers: [], inventoryMovements: [], menuItemIngredients: [], seenReservationIds: [] });
const display = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localId = (rows, row) => rows.indexOf(row) + 1;
const dateText = (value) => value ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const dateOnly = (value) => value ? String(value).slice(0, 10) : "";

export function createRestaurantDataStore({ client, restaurantId, role, userId, onError }) {
  if (!client || !restaurantId) throw new Error("An authenticated restaurant context is required.");
  const allowedTables = ROLE_READ_TABLES[role] || ROLE_READ_TABLES.staff_shared;
  const tables = new Map();
  const report = { warnings: [] };

  async function readTable(table) {
    if (!allowedTables.includes(table)) return [];
    const { data, error } = await client.from(table).select("*").eq("restaurant_id", restaurantId);
    if (error) {
      if (role === "staff_shared" && table === "complaints") {
        report.warnings.push("Complaints cannot be read by staff_shared under the current RLS policy.");
        return [];
      }
      throw new Error(`${table}: ${error.message}`);
    }
    tables.set(table, data || []);
    return data || [];
  }

  function toState() {
    const categories = tables.get("menu_categories") || [];
    const suppliers = tables.get("suppliers") || [];
    const inventoryRows = tables.get("inventory_items") || [];
    const tableRows = tables.get("dining_tables") || [];
    const employees = tables.get("employees") || [];
    const shifts = tables.get("shift_assignments") || [];
    const entries = tables.get("time_entries") || [];
    const menuRows = tables.get("menu_items") || [];
    const orderRows = tables.get("orders") || [];
    const orderItemRows = tables.get("order_items") || [];

    const inventory = inventoryRows.map((row, index) => ({ id: index + 1, dbId: row.id, name: row.name, category: "", unit: row.unit, stock: Number(row.quantity || 0), reorderAt: Number(row.minimum_quantity || 0), cost: Number(row.unit_cost || 0), supplier: suppliers.find((item) => item.id === row.supplier_id)?.name || "—" }));
    const menu = menuRows.map((row, index) => ({ id: index + 1, dbId: row.id, name: row.name, category: categories.find((item) => item.id === row.category_id)?.name || "Uncategorized", description: row.description || "", price: Number(row.price || 0), popular: false, image: row.image_url || "", recipe: (tables.get("menu_item_ingredients") || []).filter((item) => item.menu_item_id === row.id).map((item) => ({ ingredientId: inventoryRows.findIndex((inventoryItem) => inventoryItem.id === item.inventory_item_id) + 1, quantity: Number(item.quantity_required || 0), dbId: item.id })) }));
    const team = employees.map((row, index) => {
      const shift = shifts.find((item) => item.employee_id === row.id);
      const openEntry = entries.find((item) => item.employee_id === row.id && !item.clock_out);
      return { id: index + 1, dbId: row.id, shiftDbId: shift?.id, name: row.full_name, role: row.position || "Team member", email: row.email || "", phone: row.phone || "", hourlyRate: Number(row.hourly_rate || 0), employmentType: row.employment_type || "", status: openEntry ? "On shift" : display(row.status || "active"), shiftStart: shift?.start_time || "15:00", shiftEnd: shift?.end_time || "23:00", breakMinutes: 0, station: "Unassigned", initials: row.full_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), color: ["coral", "blue", "purple", "green", "gold"][index % 5], clockedInAt: openEntry?.clock_in || null };
    });
    const teamId = new Map(team.map((person) => [person.dbId, person.id]));
    const tableName = (id) => tableRows.find((item) => item.id === id)?.table_number ? `Table ${String(tableRows.find((item) => item.id === id).table_number).padStart(2, "0")}` : "—";
    const orderItemsByOrder = new Map();
    orderItemRows.forEach((item) => { const list = orderItemsByOrder.get(item.order_id) || []; list.push(item); orderItemsByOrder.set(item.order_id, list); });
    const orders = orderRows.map((row, index) => ({ id: index + 1, dbId: row.id, orderNumber: row.order_number, type: display(row.order_type), table: tableName(row.dining_table_id), customer: row.customer_name || "Walk-in", items: (orderItemsByOrder.get(row.id) || []).map((item) => ({ menuId: menuRows.findIndex((menuItem) => menuItem.id === item.menu_item_id) + 1, dbId: item.id, quantity: Number(item.quantity || 0), itemName: item.item_name, unitPrice: Number(item.unit_price || 0), lineTotal: Number(item.line_total || 0) })), total: Number(row.total_amount || 0), subtotal: Number(row.subtotal || 0), status: display(row.status), payment: display(row.payment_status), createdAt: dateText(row.created_at), date: dateOnly(row.created_at), diningTableDbId: row.dining_table_id, reservationDbId: row.reservation_id }));

    return {
      ...emptyState(),
      menu, inventory, team,
      diningTables: tableRows.map((row, index) => ({ id: index + 1, dbId: row.id, number: row.table_number, tableNumber: row.table_number, capacity: row.capacity, status: display(row.status), location: row.location || "" })),
      reservations: (tables.get("reservations") || []).map((row, index) => ({ id: index + 1, dbId: row.id, name: row.customer_name, phone: row.customer_phone || "", guests: row.party_size, time: dateText(row.reservation_at), reservationAt: row.reservation_at, table: tableName(row.dining_table_id), diningTableDbId: row.dining_table_id, status: display(row.status), notes: row.notes || "" })),
      orders,
      leaveRequests: (tables.get("leave_requests") || []).map((row, index) => ({ id: index + 1, dbId: row.id, employeeId: teamId.get(row.employee_id), startDate: row.start_date, endDate: row.end_date, type: row.reason || "Leave request", note: row.reason || "", status: display(row.status), submittedAt: dateText(row.created_at) })),
      replacementRequests: (tables.get("replacement_requests") || []).map((row, index) => ({ id: index + 1, dbId: row.id, employeeId: teamId.get(row.employee_id), replacementId: teamId.get(row.replacement_employee_id), shiftAssignmentId: row.shift_assignment_id, date: shifts.find((shift) => shift.id === row.shift_assignment_id)?.shift_date || "", reason: row.reason || "", status: display(row.status), submittedAt: dateText(row.created_at) })),
      expenses: (tables.get("expenses") || []).map((row, index) => ({ id: index + 1, dbId: row.id, date: row.expense_date, vendor: row.category || "Expense", category: row.category || "Other", description: row.description, amount: Number(row.amount || 0), status: "Paid", paymentMethod: "—", notes: row.notes || "" })),
      complaints: (tables.get("complaints") || []).map((row, index) => ({ id: index + 1, dbId: row.id, date: dateOnly(row.created_at), employeeId: teamId.get(row.employee_id), category: "General", severity: "Medium", subject: row.subject, details: row.description, status: display(row.status), submittedAt: dateText(row.created_at) })),
      wagePayments: (tables.get("wage_payments") || []).map((row, index) => ({ id: index + 1, dbId: row.id, employeeId: teamId.get(row.employee_id), period: "", amount: Number(row.amount || 0), status: "Paid", paidDate: row.payment_date, method: "—" })),
      timeEntries: entries.map((row, index) => ({ id: row.id, dbId: row.id, employeeId: teamId.get(row.employee_id), date: dateOnly(row.clock_in), clockIn: row.clock_in, clockOut: row.clock_out, breakMinutes: 0 })),
      notifications: (tables.get("notifications") || []).map((row) => ({ id: row.id, dbId: row.id, type: "info", title: row.title, detail: row.message, createdAt: dateText(row.created_at), read: row.is_read })),
      payments: tables.get("payments") || [], suppliers, inventoryMovements: tables.get("inventory_movements") || [], menuItemIngredients: tables.get("menu_item_ingredients") || []
    };
  }

  async function load() {
    report.warnings = [];
    const results = await Promise.all(allowedTables.map((table) => readTable(table)));
    void results;
    return { state: toState(), report };
  }

  const uuid = () => crypto.randomUUID();
  const dbId = (row) => { row.dbId ||= uuid(); return row.dbId; };
  const categoryId = (name) => (tables.get("menu_categories") || []).find((row) => row.name === name)?.id;
  const inventoryId = (item) => item?.dbId || (tables.get("inventory_items") || []).find((row) => row.name === item?.name)?.id;
  const employeeId = (person) => person?.dbId || (tables.get("employees") || []).find((row) => row.full_name === person?.name)?.id;
  const tableId = (value) => (tables.get("dining_tables") || []).find((row) => `Table ${String(row.table_number).padStart(2, "0")}` === value)?.id;

  async function upsert(table, rows) {
    if (!rows.length || !allowedTables.includes(table)) return;
    const { error } = await client.from(table).upsert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async function save(state) {
    try {
      await upsert("menu_items", state.menu.map((item) => ({ id: dbId(item), restaurant_id: restaurantId, category_id: categoryId(item.category), name: item.name, description: item.description || null, price: Number(item.price || 0), image_url: item.image || null })));
      await upsert("inventory_items", state.inventory.map((item) => ({ id: dbId(item), restaurant_id: restaurantId, name: item.name, unit: item.unit || "each", quantity: Number(item.stock || 0), minimum_quantity: Number(item.reorderAt || 0), unit_cost: Number(item.cost || 0), supplier_id: (suppliers.find((supplier) => supplier.name === item.supplier)?.id) || null })));
      await upsert("employees", state.team.map((person) => ({ id: dbId(person), restaurant_id: restaurantId, full_name: person.name, email: person.email || null, phone: person.phone || null, position: person.role || null, employment_type: person.employmentType || null, hourly_rate: Number(person.hourlyRate || 0), status: String(person.status || "active").toLowerCase().replace(/ /g, "_") })));
      await upsert("dining_tables", (state.diningTables || []).map((table) => ({ id: dbId(table), restaurant_id: restaurantId, table_number: table.tableNumber ?? table.number, capacity: Number(table.capacity || 2), status: String(table.status || "available").toLowerCase(), location: table.location || null })));
      await upsert("reservations", state.reservations.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, dining_table_id: row.diningTableDbId || tableId(row.table), customer_name: row.name, customer_phone: row.phone || null, party_size: Number(row.guests || 1), reservation_at: row.reservationAt || new Date().toISOString(), status: String(row.status || "confirmed").toLowerCase().replace(/ /g, "_"), notes: row.notes || null })));
      await upsert("orders", state.orders.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, order_number: row.orderNumber || String(row.id), dining_table_id: row.diningTableDbId || tableId(row.table), order_type: String(row.type || "dine_in").toLowerCase().replace(/ /g, "_"), customer_name: row.customer || null, status: String(row.status || "pending").toLowerCase(), payment_status: String(row.payment || "unpaid").toLowerCase(), subtotal: Number(row.subtotal || row.total || 0), total_amount: Number(row.total || 0), currency_code: "USD" })));
      const currentOrders = state.orders.map((row) => ({ row, id: dbId(row) }));
      const menuRows = tables.get("menu_items") || [];
      await upsert("order_items", state.orders.flatMap((order) => (order.items || []).map((item) => ({ id: dbId(item), restaurant_id: restaurantId, order_id: currentOrders.find((entry) => entry.row === order)?.id, menu_item_id: menuRows.find((menu) => menu.id === item.dbId)?.id || state.menu.find((menu) => Number(menu.id) === Number(item.menuId))?.dbId, item_name: item.itemName || state.menu.find((menu) => Number(menu.id) === Number(item.menuId))?.name || "Menu item", unit_price: Number(item.unitPrice || state.menu.find((menu) => Number(menu.id) === Number(item.menuId))?.price || 0), quantity: Number(item.quantity || 0), line_total: Number(item.lineTotal || 0) }))));
      await upsert("menu_item_ingredients", state.menu.flatMap((item) => (item.recipe || []).map((part) => ({ id: dbId(part), restaurant_id: restaurantId, menu_item_id: item.dbId, inventory_item_id: inventoryId(state.inventory.find((entry) => Number(entry.id) === Number(part.ingredientId))), quantity_required: Number(part.quantity || 0) }))));
      await upsert("shift_assignments", state.team.map((person) => { person.shiftDbId ||= uuid(); return { id: person.shiftDbId, restaurant_id: restaurantId, employee_id: employeeId(person), shift_date: new Date().toISOString().slice(0, 10), start_time: person.shiftStart || "15:00", end_time: person.shiftEnd || "23:00", notes: person.station || null }; }));
      await upsert("leave_requests", state.leaveRequests.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, employee_id: employeeId(state.team.find((person) => Number(person.id) === Number(row.employeeId))), start_date: row.startDate, end_date: row.endDate, reason: row.note || row.type || null, status: String(row.status || "pending").toLowerCase() })));
      await upsert("replacement_requests", state.replacementRequests.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, employee_id: employeeId(state.team.find((person) => Number(person.id) === Number(row.employeeId))), replacement_employee_id: employeeId(state.team.find((person) => Number(person.id) === Number(row.replacementId))), shift_assignment_id: row.shiftAssignmentId || null, reason: row.reason || null, status: String(row.status || "pending").toLowerCase() })));
      await upsert("wage_payments", state.wagePayments.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, employee_id: employeeId(state.team.find((person) => Number(person.id) === Number(row.employeeId))), amount: Number(row.amount || 0), payment_date: row.paidDate || new Date().toISOString().slice(0, 10), notes: [row.period, row.status, row.method].filter(Boolean).join("; ") || null })));
      await upsert("expenses", state.expenses.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, description: row.description || row.vendor || "Expense", category: row.category || null, amount: Number(row.amount || 0), expense_date: row.date, notes: row.notes || `Status: ${row.status || "Paid"}; payment method: ${row.paymentMethod || "—"}` })));
      await upsert("complaints", state.complaints.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, employee_id: employeeId((state.team || []).find((person) => Number(person.id) === Number(row.employeeId)) || {}), subject: row.subject, description: row.details || row.description || "", status: String(row.status || "open").toLowerCase().replace(/ /g, "_") })));
      await upsert("time_entries", state.timeEntries.map((row) => ({ id: dbId(row), restaurant_id: restaurantId, employee_id: employeeId((state.team || []).find((person) => Number(person.id) === Number(row.employeeId)) || {}), clock_in: row.clockIn, clock_out: row.clockOut || null, notes: null })));
      await upsert("payments", (state.payments || []).map((row) => ({ ...row, id: dbId(row), restaurant_id: restaurantId })));
      await upsert("inventory_movements", (state.inventoryMovements || []).map((row) => ({ ...row, id: dbId(row), restaurant_id: restaurantId })));
      await upsert("notifications", (state.notifications || []).map((row) => ({ id: dbId(row), restaurant_id: restaurantId, user_id: userId || null, title: row.title, message: row.detail || row.message || "", is_read: Boolean(row.read) })));
    } catch (error) {
      onError?.(`Could not save changes: ${error.message}`);
      throw error;
    }
  }

  async function remove(table, id) {
    if (!allowedTables.includes(table)) throw new Error(`Your role cannot remove ${table} records.`);
    const { error } = await client.from(table).delete().eq("restaurant_id", restaurantId).eq("id", id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  return { load, save, remove, get warnings() { return report.warnings; } };
}
