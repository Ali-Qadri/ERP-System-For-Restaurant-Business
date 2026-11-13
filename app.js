(() => {
  const STORAGE_KEY = "juniper-table-erp-v1";
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toast = document.getElementById("toast");
  const seed = window.RestaurantData;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value) || 0);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const initials = (name) => String(name || "").split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  const timeNow = () => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
  const safeImage = (image) => /^(assets\/food\/[a-z0-9-]+\.jpg|https:\/\/images\.unsplash\.com\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(String(image || "")) ? image : "";
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  let state = clone(seed);
  let view = "overview";
  let orderFilter = "All orders";
  let menuFilter = "All";
  let menuSearch = "";
  let inventorySearch = "";
  let reservationSearch = "";
  let selectedTeamDay = (new Date().getDay() + 6) % 7;
  let employeeTab = "directory";
  let employeeSearch = "";
  let timesheetDate = new Date();
  let kitchenFilter = "Active";
  let accountingPeriod = "This week";
  let expenseCategory = "All categories";
  let leaveStatusFilter = "All statuses";
  let coverStatusFilter = "All statuses";
  let complaintStatusFilter = "All statuses";
  let complaintSeverityFilter = "All priorities";
  let toastTimer;
  let baselineCompletedSales = 0;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
  }

  function saveState() {
    try {
      state.schemaVersion = 3;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save restaurant data.", error);
      showToast("Changes could not be saved in this browser. Export a backup to keep your data.");
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      const collections = ["menu", "inventory", "team", "reservations", "orders"];
      if (!parsed || collections.some((key) => !Array.isArray(parsed[key]))) {
        throw new Error("Saved restaurant data is incomplete.");
      }
      state = {
        ...clone(seed),
        ...parsed,
        menu: parsed.menu.map((item) => {
          const original = seed.menu.find((entry) => Number(entry.id) === Number(item.id));
          return { ...original, ...item, image: item.image || original?.image || "" };
        }),
        team: [...parsed.team.map((person) => {
          const original = seed.team.find((entry) => Number(entry.id) === Number(person.id));
          return { ...original, ...person, role: person.role === "Server" && original?.role === "Waiter" ? "Waiter" : person.role };
        }), ...(Number(parsed.schemaVersion || 0) < 3 ? seed.team.filter((person) => !parsed.team.some((saved) => Number(saved.id) === Number(person.id))) : [])],
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
    } catch (error) {
      console.error("Could not load saved restaurant data.", error);
      showToast("Saved data could not be read. Showing the demo data instead.");
    }
  }

  function lowStockItems() {
    return state.inventory.filter((item) => item.stock <= item.reorderAt);
  }

  function findMenuItem(id) {
    return state.menu.find((item) => Number(item.id) === Number(id));
  }

  function itemCount(order) {
    return (order.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0);
  }

  function orderStatusClass(status) {
    return String(status).toLowerCase().replace(/\s+/g, "-");
  }

  function formatShiftTime(value) {
    if (!value) return "3:00 PM";
    const [hour, minute] = value.split(":").map(Number);
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2020, 0, 1, hour, minute));
  }

  function shiftLength(person) {
    const [startHour, startMinute] = (person.shiftStart || "15:00").split(":").map(Number);
    const [endHour, endMinute] = (person.shiftEnd || "23:00").split(":").map(Number);
    let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
    if (minutes <= 0) minutes += 24 * 60;
    return Math.max(0, (minutes - Number(person.breakMinutes || 0)) / 60);
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDateLabel(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
  }

  function dateAtTime(dateKey, time) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute);
  }

  function formatEntryTime(value) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }

  function entryMinutes(entry) {
    const start = new Date(entry.clockIn).getTime();
    const end = entry.clockOut ? new Date(entry.clockOut).getTime() : Date.now();
    return Math.max(0, Math.round((end - start) / 60000) - Number(entry.breakMinutes || 0));
  }

  function entryHours(entry) {
    return entryMinutes(entry) / 60;
  }

  function ensureEmployeeData() {
    state.notifications ||= [];
    state.timeEntries ||= [];
    state.leaveRequests ||= [];
    state.replacementRequests ||= [];
    const today = localDateKey(new Date());
    if (!state.timeEntries.length && state.team.length) {
      state.team.forEach((person, index) => {
        if (person.status === "On shift") {
          const clockIn = new Date(Date.now() - (2.5 + index * 0.15) * 60 * 60 * 1000);
          person.clockedInAt = clockIn.toISOString();
          state.timeEntries.push({ id: `time-${person.id}-${today}`, employeeId: person.id, date: today, clockIn: clockIn.toISOString(), clockOut: null, breakMinutes: 0 });
        } else {
          const previous = new Date();
          previous.setDate(previous.getDate() - 1);
          const date = localDateKey(previous);
          const start = dateAtTime(date, person.shiftStart || "15:00");
          const paidHours = shiftLength(person);
          const end = new Date(start.getTime() + (paidHours * 60 + Number(person.breakMinutes || 0)) * 60000);
          state.timeEntries.push({ id: `time-${person.id}-${date}`, employeeId: person.id, date, clockIn: start.toISOString(), clockOut: end.toISOString(), breakMinutes: Number(person.breakMinutes || 0) });
        }
      });
    } else {
      state.team.forEach((person) => {
        const openEntry = state.timeEntries.find((entry) => Number(entry.employeeId) === Number(person.id) && entry.date === today && !entry.clockOut);
        if (openEntry) {
          person.status = "On shift";
          person.clockedInAt = openEntry.clockIn;
        } else if (person.status === "On shift") {
          person.clockedInAt ||= new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          state.timeEntries.push({ id: `time-${person.id}-${today}`, employeeId: person.id, date: today, clockIn: person.clockedInAt, clockOut: null, breakMinutes: 0 });
        }
      });
    }
    state.team.forEach((person) => {
      person.shiftStart ||= "15:00";
      person.shiftEnd ||= "23:00";
      person.breakMinutes = Number(person.breakMinutes || 0);
      person.station ||= "Unassigned";
      person.initials ||= initials(person.name);
    });
  }

  function weekDate(dayIndex) {
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    monday.setDate(monday.getDate() + dayIndex);
    return monday;
  }

  function dateIsToday(date) {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }

  function shiftProgress(person) {
    if (!person.shiftStart || !person.shiftEnd) return 0;
    const now = new Date();
    const [startHour, startMinute] = person.shiftStart.split(":").map(Number);
    const [endHour, endMinute] = person.shiftEnd.split(":").map(Number);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMinute);
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour, endMinute);
    if (end <= start) end.setDate(end.getDate() + 1);
    if (now <= start) return 0;
    if (now >= end) return 100;
    return Math.round((now - start) / (end - start) * 100);
  }

  function addNotification(type, title, detail) {
    state.notifications ||= [];
    state.notifications.unshift({ id: Date.now(), type, title, detail, createdAt: timeNow(), read: false });
    saveState();
  }

  function renderHeader() {
    const labels = { overview: "Overview", orders: "Orders", kitchen: "Kitchen", menu: "Menu", inventory: "Inventory", team: "Employees", reservations: "Reservations", accounting: "Accounting", complaints: "Complaints", reports: "Reports" };
    document.getElementById("current-section").textContent = labels[view] || "Overview";
    document.getElementById("today-label").textContent = `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date())} · ${timeNow()}`;
    document.getElementById("open-order-count").textContent = state.orders.filter((order) => !["Completed", "Cancelled"].includes(order.status)).length;
    const seenReservations = new Set(state.seenReservationIds || []);
    const unreadCount = (state.notifications || []).filter((item) => !item.read).length + (state.reservations || []).filter((item) => item.status === "Confirmed" && !seenReservations.has(item.id)).length;
    const notificationBadge = document.getElementById("notification-count");
    notificationBadge.textContent = unreadCount ? String(unreadCount) : "";
    notificationBadge.hidden = !unreadCount;
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  }

  function render() {
    renderHeader();
    const pages = {
      overview: renderOverview,
      orders: renderOrders,
      kitchen: renderKitchen,
      menu: renderMenu,
      inventory: renderInventory,
      team: renderTeam,
      reservations: renderReservations,
      accounting: renderAccounting,
      complaints: renderComplaints,
      reports: renderReports
    };
    app.innerHTML = (pages[view] || renderOverview)();
    app.querySelectorAll(".dish-art img").forEach((image) => {
      image.addEventListener("error", () => {
        image.hidden = true;
        image.closest(".dish-art")?.classList.remove("has-photo");
      }, { once: true });
    });
  }

  function pageHeading(eyebrow, title, description, action = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
  }

  function renderOverview() {
    const activeOrders = state.orders.filter((order) => !["Completed", "Cancelled"].includes(order.status));
    const alerts = lowStockItems();
    const liveOrders = state.orders.filter((order) => !["Completed", "Cancelled"].includes(order.status)).slice(0, 4);
    const maxSales = Math.max(...seed.sales);
    const bars = seed.sales.map((sale, index) => `<div class="chart-column"><span class="chart-value">${money(sale)}</span><div class="chart-bar ${index === 5 ? "highlight" : ""}" style="height:${Math.max(14, (sale / maxSales) * 100)}%"></div><span class="chart-label">${esc(seed.salesLabels[index])}</span></div>`).join("");
    const alertRows = alerts.slice(0, 4).map((item) => `<div class="alert-row"><span class="ingredient-icon">◈</span><span class="alert-name"><strong>${esc(item.name)}</strong><small>${esc(item.category)}</small></span><span class="alert-stock">${item.stock.toFixed(1)} ${esc(item.unit)}<small>Reorder at ${item.reorderAt} ${esc(item.unit)}</small></span></div>`).join("");
    const orderRows = liveOrders.map((order) => `<div class="live-order-row"><span class="order-number">#${order.id}</span><span class="live-order-info"><strong>${esc(order.customer)}</strong><small>${esc(order.type)} · ${itemCount(order)} items</small></span><span class="status-badge ${orderStatusClass(order.status)}">${esc(order.status)}</span><strong class="live-order-total">${money(order.total)}</strong></div>`).join("");
    const staffOnShift = state.team.filter((person) => person.status === "On shift").length;
    const currentCompletedSales = state.orders.filter((order) => order.status === "Completed").reduce((sum, order) => sum + Number(order.total), 0);
    const todaySales = Math.max(0, 2840 + currentCompletedSales - baselineCompletedSales);
    const newOrders = Math.max(0, state.orders.length - seed.orders.length);
    const newCompletedOrders = Math.max(0, state.orders.filter((order) => order.status === "Completed").length - seed.orders.filter((order) => order.status === "Completed").length);
    const averageCheck = (59.17 * 48 + currentCompletedSales - baselineCompletedSales) / (48 + newCompletedOrders);
    const upcomingReservations = state.reservations.filter((booking) => booking.status === "Confirmed").length;
    return `
      ${pageHeading(`<span class="live-dot"></span> ${new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date()).toUpperCase()} SERVICE · <span id="dashboard-clock">${timeNow()}</span>`, `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, Alex <span class='wave'>✳</span>`, "Here’s what’s happening at Juniper Table today.", `<button class="button button-outline" data-action="export">↗ <span>Export report</span></button>`)}
      <section class="metrics-grid">
        <article class="metric-card"><div class="metric-top"><span>Today's sales</span><span class="metric-icon green">↗</span></div><strong class="metric-value">${money(todaySales)}<span class="metric-trend">↗ 12.8%</span></strong><div class="metric-foot">Live total · updates as orders close</div><div class="sparkline green-spark"><i style="height:25%"></i><i style="height:38%"></i><i style="height:33%"></i><i style="height:53%"></i><i style="height:48%"></i><i style="height:72%"></i><i style="height:66%"></i><i style="height:88%"></i></div></article>
        <article class="metric-card"><div class="metric-top"><span>Orders today</span><span class="metric-icon blue">▤</span></div><strong class="metric-value">${48 + newOrders}<span class="metric-trend">↗ 8.2%</span></strong><div class="metric-foot"><span class="dot dot-blue"></span>${activeOrders.length} currently in progress</div><div class="metric-progress"><span style="width:${Math.min(100, Math.round((48 + newOrders) / 67 * 100))}%"></span></div><div class="metric-foot progress-label">${Math.min(100, Math.round((48 + newOrders) / 67 * 100))}% of daily order goal</div></article>
        <article class="metric-card"><div class="metric-top"><span>Average check</span><span class="metric-icon purple">$</span></div><strong class="metric-value">${money(averageCheck)}<span class="metric-trend">↗ 4.3%</span></strong><div class="metric-foot">Across completed orders today</div><div class="mini-bars purple-bars"><i style="height:38%"></i><i style="height:55%"></i><i style="height:48%"></i><i style="height:76%"></i><i style="height:63%"></i><i style="height:92%"></i><i style="height:79%"></i></div></article>
        <article class="metric-card"><div class="metric-top"><span>Team on shift</span><span class="metric-icon orange">♙</span></div><strong class="metric-value">${staffOnShift}<small> / ${state.team.length}</small></strong><div class="metric-foot"><span class="dot dot-green"></span>${state.team.length - staffOnShift} scheduled to join later</div><div class="avatar-stack">${state.team.filter((person) => person.status === "On shift").slice(0, 4).map((person) => `<span class="mini-avatar ${esc(person.color)}" title="${esc(person.name)}">${esc(person.initials)}</span>`).join("")}<span class="avatar-extra">+${Math.max(0, staffOnShift - 4)}</span></div></article>
      </section>
      <section class="overview-grid">
        <article class="panel sales-panel"><div class="panel-heading"><div><h2>Sales overview</h2><p>Weekly performance at a glance</p></div><select class="select-small" aria-label="Sales period"><option>This week</option><option>This month</option></select></div><div class="sales-summary"><strong>$16,010</strong><span class="metric-trend">↗ 9.4% <span class="muted">vs. last week</span></span></div><div class="bar-chart">${bars}</div></article>
        <article class="panel"><div class="panel-heading"><div><h2>Inventory alerts</h2><p>${alerts.length} ingredients need attention</p></div><button class="text-button" data-view="inventory">View inventory <span>→</span></button></div><div class="alert-list">${alertRows || `<div class="empty-state compact">All ingredients are well stocked.</div>`}</div><button class="button button-soft full-button" data-view="inventory">Manage inventory <span>→</span></button></article>
        <article class="panel orders-panel"><div class="panel-heading"><div><h2>Live orders</h2><p>Keep service moving</p></div><button class="text-button" data-view="orders">All orders <span>→</span></button></div><div class="live-orders">${orderRows || `<div class="empty-state compact">No open orders right now.</div>`}</div></article>
        <article class="panel service-panel"><div class="panel-heading"><div><h2>Service snapshot</h2><p>Tonight at a glance</p></div><span class="live-pill"><i></i> LIVE</span></div><div class="snapshot-stats"><div><span>Reservations</span><strong>${upcomingReservations}<small> bookings</small></strong></div><div><span>Tables occupied</span><strong>${Math.min(14, state.orders.filter((order) => order.type === "Dine in" && !["Completed", "Cancelled"].includes(order.status)).length + 6)}<small> / 14</small></strong></div><div><span>Avg. wait time</span><strong>${Math.max(5, 12 + activeOrders.length - 3)}<small> min</small></strong></div></div><div class="snapshot-footer"><span class="service-icon">✦</span><span><strong>Looking good!</strong><small>${activeOrders.length} active tickets · ${state.reservations.length} bookings on the books</small></span></div></article>
      </section>`;
  }

  function orderRow(order) {
    const lines = (order.items || []).map((line) => `${line.quantity}× ${findMenuItem(line.menuId)?.name || "Menu item"}`).join(", ");
    const next = order.status === "Preparing" ? "Start cooking" : order.status === "Cooking" ? "Mark ready" : order.status === "Ready" ? "Complete" : "";
    return `<tr><td><strong class="table-order-id">#${order.id}</strong></td><td><div class="customer-cell"><span class="customer-avatar">${esc(initials(order.customer))}</span><span><strong>${esc(order.customer)}</strong><small>${esc(lines)}</small></span></div></td><td><span class="type-label">${esc(order.type)}</span></td><td>${esc(order.table)}</td><td>${esc(order.createdAt)}</td><td><span class="status-badge ${orderStatusClass(order.status)}">${esc(order.status)}</span></td><td><strong>${money(order.total)}</strong></td><td><div class="row-actions">${next ? `<button class="button button-small button-soft" data-action="advance-order" data-id="${order.id}">${next}</button>` : ""}<button class="more-button" aria-label="Order actions" data-action="order-menu" data-id="${order.id}">···</button></div></td></tr>`;
  }

  function renderOrders() {
    const filters = ["All orders", "Preparing", "Cooking", "Ready", "Completed"];
    const filtered = state.orders.filter((order) => orderFilter === "All orders" || order.status === orderFilter);
    return `${pageHeading("SERVICE MANAGEMENT", "Orders", "Track every ticket from the table to the kitchen.", `<div class="heading-actions"><button class="button button-outline" data-action="print-page">▤ Print orders</button><button class="button button-primary" data-action="new-order">＋ New order</button></div>`)}
      <section class="panel table-panel"><div class="table-toolbar"><div class="filter-tabs">${filters.map((filter) => `<button class="filter-tab ${orderFilter === filter ? "active" : ""}" data-action="order-filter" data-filter="${esc(filter)}">${filter}<span>${filter === "All orders" ? state.orders.length : state.orders.filter((order) => order.status === filter).length}</span></button>`).join("")}</div><button class="button button-outline" data-action="export-orders">↗ Export</button></div>
      ${filtered.length ? `<div class="table-scroll"><table class="data-table orders-table"><thead><tr><th>ORDER</th><th>CUSTOMER &amp; ITEMS</th><th>TYPE</th><th>TABLE</th><th>TIME</th><th>STATUS</th><th>TOTAL</th><th></th></tr></thead><tbody>${filtered.map(orderRow).join("")}</tbody></table></div>` : `<div class="empty-state">No orders in this view yet.</div>`}</section>
      <div class="hint-banner"><span>✦</span><div><strong>Kitchen workflow</strong><small>New orders appear as “Preparing”. Mark a ticket ready when the kitchen is done, then complete it when it’s served.</small></div></div>`;
  }

  function renderKitchen() {
    const activeOrders = state.orders.filter((order) => !["Completed", "Cancelled"].includes(order.status));
    const filtered = activeOrders.filter((order) => kitchenFilter === "Active" || order.status === kitchenFilter);
    const chefs = state.team.filter((person) => /chef|cook/i.test(person.role));
    const cookingCount = activeOrders.filter((order) => ["Preparing", "Cooking"].includes(order.status)).length;
    const readyCount = activeOrders.filter((order) => order.status === "Ready").length;
    const cards = filtered.map((order) => {
      const stepLabel = order.status === "Preparing" ? "Start cooking" : order.status === "Cooking" ? "Mark ready" : "Mark served";
      const ticketItems = order.items.map((line) => {
        const dish = findMenuItem(line.menuId);
        return `<div class="kitchen-item"><span class="kitchen-item-qty">${line.quantity}×</span><span class="kitchen-item-details"><strong>${esc(dish?.name || "Menu item")}</strong><small>${esc(dish?.description || "")}</small></span><span class="kitchen-item-category">${esc(dish?.category || "")}</span></div>`;
      }).join("");
      return `<article class="kitchen-ticket ${order.status === "Ready" ? "ticket-ready" : ""}"><header class="ticket-header"><div><span class="ticket-order">#${order.id}</span><span class="status-badge ${orderStatusClass(order.status)}">${esc(order.status)}</span></div><span class="ticket-time">Received ${esc(order.createdAt)}</span></header><div class="ticket-table"><strong>${esc(order.table === "—" ? order.type : order.table)}</strong><span>${esc(order.customer)}</span></div><div class="ticket-items">${ticketItems}</div><div class="ticket-footer"><label class="chef-select"><span>Assigned chef</span><select data-action="assign-chef" data-id="${order.id}"><option value="">Unassigned</option>${chefs.map((chef) => `<option value="${chef.id}" ${Number(order.chefId) === Number(chef.id) ? "selected" : ""}>${esc(chef.name)}</option>`).join("")}</select></label><button class="button ${order.status === "Ready" ? "button-primary" : "button-soft"}" data-action="kitchen-status" data-id="${order.id}">${stepLabel} →</button></div></article>`;
    }).join("");
    return `${pageHeading("BACK OF HOUSE · LIVE TICKETS", "Kitchen display", "Order tickets from service, updated live as the front of house sends and advances orders.", `<div class="heading-actions"><span class="live-pill"><i></i> LIVE QUEUE</span><button class="button button-outline" data-action="print-page">▤ Print queue</button></div>`)}
      <section class="kitchen-summary"><div><span>Cooking</span><strong>${cookingCount}</strong><small>Active tickets</small></div><div><span>Ready to serve</span><strong>${readyCount}</strong><small>Waiting for pickup</small></div><div><span>Kitchen team</span><strong>${chefs.length}</strong><small>Chefs &amp; cooks on roster</small></div><div class="kitchen-clock"><span>Local time</span><strong id="kitchen-live-clock">${timeNow()}</strong><small>Updates every second</small></div></section>
      <div class="kitchen-toolbar"><div class="filter-tabs">${["Active", "Preparing", "Cooking", "Ready"].map((filter) => `<button class="filter-tab ${kitchenFilter === filter ? "active" : ""}" data-action="kitchen-filter" data-filter="${filter}">${filter}<span>${filter === "Active" ? activeOrders.length : activeOrders.filter((order) => order.status === filter).length}</span></button>`).join("")}</div><span class="queue-updated"><i></i> Synced with Orders</span></div>
      <div class="kitchen-grid">${cards || `<section class="panel empty-state">No tickets in this queue. New orders will appear here as soon as they're sent to the kitchen.</section>`}</div>
      <div class="hint-banner"><span>↔</span><div><strong>One live order queue</strong><small>Orders entered in the POS are displayed here. Update a ticket's cooking status and it changes on the Orders page too.</small></div></div>`;
  }

  function renderMenu() {
    const categories = ["All", ...new Set(state.menu.map((item) => item.category))];
    const matching = state.menu.filter((item) => (menuFilter === "All" || item.category === menuFilter) && item.name.toLowerCase().includes(menuSearch.toLowerCase()));
    const cards = matching.map((item) => {
      const image = safeImage(item.image);
      return `<article class="menu-card"><div class="dish-art dish-${item.id % 6} ${image ? "has-photo" : ""}">${image ? `<img src="${esc(image)}" alt="${esc(item.name)}" loading="lazy">` : ""}<span>${esc(item.category)}</span><button class="dish-menu" aria-label="Edit ${esc(item.name)}" data-action="edit-menu" data-id="${item.id}">···</button><span class="dish-symbol">${({ Mains: "✳", Starters: "◉", Sides: "✦", Desserts: "❋", Drinks: "◌" })[item.category] || "✳"}</span></div><div class="menu-card-content"><div class="menu-card-heading"><h3>${esc(item.name)}</h3><strong>${money(item.price)}</strong></div><p>${esc(item.description)}</p><div class="menu-card-footer"><span class="category-pill">${esc(item.category)}</span>${item.popular ? `<span class="popular-label">★ Popular</span>` : `<span class="recipe-label">${(item.recipe || []).length} recipe ingredients</span>`}</div><div class="menu-card-actions"><button class="text-button" data-action="edit-menu" data-id="${item.id}">Edit item</button><button class="text-button danger-text" data-action="delete-menu" data-id="${item.id}">Remove</button></div></div></article>`;
    }).join("");
    return `${pageHeading("WHAT'S COOKING", "Menu", "Manage dishes, pricing, and the ingredients behind every plate.", `<button class="button button-primary" data-action="add-menu">＋ Add menu item</button>`)}
      <div class="menu-toolbar"><div class="filter-tabs">${categories.map((category) => `<button class="filter-tab ${menuFilter === category ? "active" : ""}" data-action="menu-filter" data-filter="${esc(category)}">${esc(category)}</button>`).join("")}</div><label class="search-field"><span>⌕</span><input id="menu-search" type="search" placeholder="Search menu..." value="${esc(menuSearch)}"></label></div>
      ${matching.length ? `<div class="menu-grid">${cards}</div>` : `<div class="panel empty-state">No menu items match your search.</div>`}`;
  }

  function renderInventory() {
    const query = inventorySearch.toLowerCase();
    const items = state.inventory.filter((item) => `${item.name} ${item.category} ${item.supplier}`.toLowerCase().includes(query));
    const low = lowStockItems().length;
    const stockValue = state.inventory.reduce((sum, item) => sum + item.stock * item.cost, 0);
    return `${pageHeading("BACK OF HOUSE", "Inventory", "Keep ingredients in check and stay ahead of your next delivery.", `<div class="heading-actions"><button class="button button-outline" data-action="print-page">▤ Print inventory</button><button class="button button-primary" data-action="add-ingredient">＋ Add ingredient</button></div>`)}
      <div class="inventory-metrics"><div class="inventory-metric"><span>Total ingredients</span><strong>${state.inventory.length}</strong></div><div class="inventory-metric"><span>Need reordering</span><strong class="${low ? "text-warning" : ""}">${low}</strong></div><div class="inventory-metric"><span>Stock value</span><strong>${money(stockValue)}</strong></div><div class="inventory-metric"><span>Active suppliers</span><strong>${new Set(state.inventory.map((item) => item.supplier)).size}</strong></div></div>
      ${low ? `<div class="inventory-alert"><span>!</span><div><strong>${low} ${low === 1 ? "ingredient is" : "ingredients are"} at or below reorder level</strong><small>Review your stock and create a purchase order with your supplier.</small></div><button class="text-button" data-action="reorder-list">Review items →</button></div>` : ""}
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Ingredients</h2><p>Stock levels and supplier details</p></div><label class="search-field"><span>⌕</span><input id="inventory-search" type="search" placeholder="Search ingredients..." value="${esc(inventorySearch)}"></label></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>INGREDIENT</th><th>CATEGORY</th><th>IN STOCK</th><th>REORDER AT</th><th>UNIT COST</th><th>SUPPLIER</th><th>STATUS</th><th></th></tr></thead><tbody>${items.map((item) => { const lowStock = item.stock <= item.reorderAt; return `<tr><td><strong>${esc(item.name)}</strong></td><td><span class="category-pill">${esc(item.category)}</span></td><td><strong>${item.stock.toFixed(2).replace(/\.?0+$/, "")} ${esc(item.unit)}</strong></td><td>${item.reorderAt} ${esc(item.unit)}</td><td>${money(item.cost)} / ${esc(item.unit)}</td><td>${esc(item.supplier)}</td><td><span class="status-badge ${lowStock ? "low-stock" : "in-stock"}">${lowStock ? "Low stock" : "In stock"}</span></td><td><button class="button button-small button-outline" data-action="adjust-stock" data-id="${item.id}">Adjust</button></td></tr>`; }).join("") || `<tr><td colspan="8" class="empty-cell">No ingredients found.</td></tr>`}</tbody></table></div></section>
      <div class="hint-banner"><span>↗</span><div><strong>Stock is connected to your menu</strong><small>New orders deduct recipe ingredients automatically. Add recipe quantities to menu items to keep on-hand counts accurate.</small></div></div>`;
  }

  function renderTeam() {
    const tabs = [
      ["directory", "Directory"],
      ["schedule", "Schedule"],
      ["timesheets", "Timesheets"],
      ["leave", "Leave requests"],
      ["coverage", "Shift cover"]
    ];
    const contents = {
      directory: renderEmployeeDirectory,
      schedule: renderSchedule,
      timesheets: renderTimesheets,
      leave: renderLeaveRequests,
      coverage: renderCoverageRequests
    };
    const employeeAction = employeeTab === "directory" ? `<button class="button button-primary" data-action="add-team">＋ Add employee</button>` : employeeTab === "leave" ? `<button class="button button-primary" data-action="add-leave">＋ Request leave</button>` : employeeTab === "coverage" ? `<button class="button button-primary" data-action="add-cover">＋ Request cover</button>` : employeeTab === "timesheets" ? `<button class="button button-primary" data-action="add-time-entry">＋ Add time entry</button>` : "";
    const addAction = `<div class="heading-actions"><button class="button button-outline" data-action="print-page">▤ Print ${employeeTab === "directory" ? "employees" : employeeTab === "timesheets" ? "timesheet" : employeeTab === "leave" ? "leave" : employeeTab === "coverage" ? "cover requests" : "schedule"}</button>${employeeAction}</div>`;
    return `${pageHeading("PEOPLE OPERATIONS", "Employees", "Manage your team, shift coverage, time records, and requests.", addAction)}
      <nav class="employee-tabs" aria-label="Employee tools">${tabs.map(([key, label]) => `<button class="employee-tab ${employeeTab === key ? "active" : ""}" data-action="employee-tab" data-tab="${key}">${label}${key === "leave" && state.leaveRequests.some((request) => request.status === "Pending") ? `<span class="tab-count">${state.leaveRequests.filter((request) => request.status === "Pending").length}</span>` : ""}${key === "coverage" && state.replacementRequests.some((request) => request.status === "Pending") ? `<span class="tab-count">${state.replacementRequests.filter((request) => request.status === "Pending").length}</span>` : ""}</button>`).join("")}</nav>
      ${(contents[employeeTab] || renderEmployeeDirectory)()}`;
  }

  function renderEmployeeDirectory() {
    const query = employeeSearch.toLowerCase();
    const employees = state.team.filter((person) => `${person.name} ${person.role} ${person.email || ""} ${person.station || ""}`.toLowerCase().includes(query));
    const onShift = state.team.filter((person) => person.status === "On shift").length;
    const waiters = state.team.filter((person) => person.role.toLowerCase().includes("waiter")).length;
    return `<section class="employee-overview-cards"><div><span>Total employees</span><strong>${state.team.length}</strong><small>Across all roles</small></div><div><span>Waiters</span><strong>${waiters}</strong><small>Front-of-house team</small></div><div><span>Clocked in today</span><strong>${onShift}</strong><small>${state.team.length - onShift} scheduled / off shift</small></div><div><span>Open requests</span><strong>${state.leaveRequests.filter((item) => item.status === "Pending").length + state.replacementRequests.filter((item) => item.status === "Pending").length}</strong><small>Leave &amp; shift cover</small></div></section>
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Employee directory</h2><p>All employees, roles, and contact details</p></div><label class="search-field"><span>⌕</span><input id="employee-search" type="search" placeholder="Search employees..." value="${esc(employeeSearch)}"></label></div>
      <div class="table-scroll"><table class="data-table employee-table"><thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>STATION</th><th>CONTACT</th><th>EMPLOYMENT</th><th>STATUS</th><th>PAID HOURS</th><th></th></tr></thead><tbody>${employees.map((person) => {
        const hours = state.timeEntries.filter((entry) => Number(entry.employeeId) === Number(person.id) && entry.date === localDateKey(new Date())).reduce((sum, entry) => sum + entryHours(entry), 0);
        const shiftAction = person.status === "On shift" ? "Clock out" : person.status === "Completed" ? "Shift ended" : "Clock in";
        return `<tr><td><div class="employee-name-cell"><span class="team-avatar ${esc(person.color)}">${esc(person.initials)}</span><strong>${esc(person.name)}</strong></div></td><td><span class="role-pill ${person.role.toLowerCase().includes("waiter") ? "waiter-role" : ""}">${esc(person.role)}</span></td><td>${esc(person.station || "—")}</td><td><span class="employee-contact">${esc(person.email || person.phone || "No contact details")}</span></td><td>${esc(person.employmentType || "Full time")}</td><td><span class="status-badge ${orderStatusClass(person.status)}">${esc(person.status)}</span></td><td><strong>${hours.toFixed(2)} hrs</strong></td><td><div class="row-actions"><button class="button button-small button-soft" data-action="toggle-team" data-id="${person.id}" ${person.status === "Completed" ? "disabled" : ""}>${shiftAction}</button><button class="more-button" data-action="edit-team" data-id="${person.id}" aria-label="Edit ${esc(person.name)}">···</button></div></td></tr>`;
      }).join("") || `<tr><td colspan="8" class="empty-cell">No employees match your search.</td></tr>`}</tbody></table></div></section>
      <div class="hint-banner"><span>♙</span><div><strong>Front-of-house team</strong><small>Waiters are listed alongside kitchen and bar employees. Use the Shift cover tab when someone needs a replacement.</small></div></div>`;
  }

  function renderSchedule() {
    const selectedDate = weekDate(selectedTeamDay);
    const todaySelected = dateIsToday(selectedDate);
    const onShift = todaySelected ? state.team.filter((person) => person.status === "On shift").length : 0;
    const scheduledHours = state.team.reduce((sum, person) => sum + shiftLength(person), 0);
    const days = dayNames.map((day, index) => {
      const date = weekDate(index);
      return `<button class="schedule-day ${selectedTeamDay === index ? "active" : ""} ${dateIsToday(date) ? "today" : ""}" data-action="team-day" data-day="${index}"><span>${day.slice(0, 3)}</span><strong>${date.getDate()}</strong>${dateIsToday(date) ? `<i></i>` : ""}</button>`;
    }).join("");
    const cards = state.team.map((person) => {
      const status = todaySelected ? person.status : "Upcoming";
      const progress = todaySelected && status === "On shift" ? shiftProgress(person) : 0;
      const buttonLabel = status === "On shift" ? "Clock out" : status === "Completed" ? "Shift ended" : "Clock in";
      const disabled = !todaySelected || status === "Completed";
      const elapsedText = status === "On shift" && person.clockedInAt ? `<span class="shift-elapsed" data-elapsed="${esc(person.clockedInAt)}"></span>` : `${shiftLength(person).toFixed(1)} paid hrs`;
      return `<article class="team-card shift-card" data-employee-id="${person.id}"><div class="team-card-top"><span class="team-avatar large ${esc(person.color)}">${esc(person.initials)}</span><button class="more-button" data-action="edit-team" data-id="${person.id}" aria-label="Edit ${esc(person.name)}">···</button></div><div class="shift-person-heading"><h3>${esc(person.name)}</h3><span class="status-badge ${orderStatusClass(status)}">${esc(status)}</span></div><p>${esc(person.role)}</p><div class="shift-time-block"><div class="shift-time-line"><span class="shift-time-icon">◷</span><strong>${formatShiftTime(person.shiftStart)} – ${formatShiftTime(person.shiftEnd)}</strong><span>${elapsedText}</span></div><div class="shift-progress"><i style="width:${progress}%"></i></div></div><div class="shift-meta"><span><small>STATION</small><strong>${esc(person.station || "Unassigned")}</strong></span><span><small>BREAK</small><strong>${Number(person.breakMinutes || 0)} min</strong></span><span><small>HOURS</small><strong>${shiftLength(person).toFixed(1)} hrs</strong></span></div><div class="team-card-footer"><button class="text-button" data-action="edit-team" data-id="${person.id}">Edit shift</button><button class="button button-small ${status === "On shift" ? "button-danger" : "button-soft"}" data-action="toggle-team" data-id="${person.id}" ${disabled ? "disabled" : ""}>${buttonLabel}</button></div></article>`;
    }).join("");
    return `<section class="team-summary"><div class="team-summary-copy"><span class="live-pill"><i></i> LIVE SHIFT TRACKER <strong id="team-live-clock">${timeNow()}</strong></span><h2>${onShift} team members clocked in</h2><p>${todaySelected ? `${state.team.length - onShift} more scheduled · ${scheduledHours.toFixed(1)} paid labor hours planned` : `Schedule for ${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(selectedDate)} · ${scheduledHours.toFixed(1)} paid labor hours`}</p></div><div class="team-summary-avatars">${state.team.filter((person) => todaySelected && person.status === "On shift").slice(0, 5).map((person) => `<span class="team-avatar ${esc(person.color)}">${esc(person.initials)}</span>`).join("")}<span class="team-avatar more-avatar">${todaySelected ? `+${Math.max(0, onShift - 5)}` : state.team.length}</span></div></section>
      <div class="section-title-row"><div><h2>Weekly schedule</h2><p>Select a day to see shift times, stations, and coverage.</p></div><button class="button button-outline" data-action="export-team">↗ Export schedule</button></div>
      <section class="schedule-board"><div class="schedule-days">${days}</div><div class="schedule-day-heading"><div><strong>${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(selectedDate)}</strong><small>${todaySelected ? "Live clock-ins update as you manage shifts" : "Planned staff coverage"}</small></div><span class="schedule-summary">${state.team.length} shifts <i>·</i> ${scheduledHours.toFixed(1)} paid hours</span></div></section>
      <div class="team-grid">${cards || `<div class="panel empty-state">Add your first team member to get started.</div>`}</div>`;
  }

  function renderTimesheets() {
    const dateKey = localDateKey(timesheetDate);
    const entries = state.timeEntries.filter((entry) => entry.date === dateKey).sort((a, b) => String(a.clockIn).localeCompare(String(b.clockIn)));
    const totalMinutes = entries.reduce((sum, entry) => sum + entryMinutes(entry), 0);
    const openEntries = entries.filter((entry) => !entry.clockOut).length;
    return `<div class="timesheet-toolbar"><div><h2>Time records</h2><p>Actual clock-ins, breaks, and paid hours</p></div><div class="timesheet-date-control"><button class="icon-button" data-action="timesheet-day" data-delta="-1" aria-label="Previous day">‹</button><input id="timesheet-date" type="date" value="${dateKey}" aria-label="Timesheet date"><button class="icon-button" data-action="timesheet-day" data-delta="1" aria-label="Next day">›</button></div></div>
      <section class="employee-overview-cards"><div><span>Paid hours</span><strong>${(totalMinutes / 60).toFixed(2)}</strong><small>For selected day</small></div><div><span>Clock-ins</span><strong>${entries.length}</strong><small>${openEntries} active shift${openEntries === 1 ? "" : "s"}</small></div><div><span>Employees on record</span><strong>${new Set(entries.map((item) => item.employeeId)).size}</strong><small>With time entries</small></div><div><span>Overtime</span><strong>${(Math.max(0, totalMinutes - 8 * 60) / 60).toFixed(2)}</strong><small>Daily hours over 8</small></div></section>
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Timesheet · ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(timesheetDate)}</h2><p>Open shifts continue counting until clock-out</p></div><button class="button button-outline" data-action="export-timesheets">↗ Export timesheet</button></div>
      <div class="table-scroll"><table class="data-table employee-table"><thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>CLOCK IN</th><th>CLOCK OUT</th><th>BREAK</th><th>PAID HOURS</th><th>STATUS</th><th></th></tr></thead><tbody>${entries.map((entry) => {
        const person = state.team.find((employee) => Number(employee.id) === Number(entry.employeeId));
        if (!person) return "";
        const hours = entryMinutes(entry) / 60;
        return `<tr><td><div class="employee-name-cell"><span class="team-avatar ${esc(person.color)}">${esc(person.initials)}</span><strong>${esc(person.name)}</strong></div></td><td>${esc(person.role)}</td><td>${formatEntryTime(entry.clockIn)}</td><td>${entry.clockOut ? formatEntryTime(entry.clockOut) : "—"}</td><td>${Number(entry.breakMinutes || 0)} min</td><td><strong>${hours.toFixed(2)} hrs</strong></td><td><span class="status-badge ${entry.clockOut ? "completed" : "on-shift"}">${entry.clockOut ? "Complete" : "Clocked in"}</span></td><td><button class="button button-small button-outline" data-action="edit-time-entry" data-id="${esc(entry.id)}">Edit</button></td></tr>`;
      }).join("") || `<tr><td colspan="8" class="empty-cell">No time records for this date. Use “Add time entry” or clock an employee in from the directory.</td></tr>`}</tbody></table></div></section>`;
  }

  function renderLeaveRequests() {
    const requests = state.leaveRequests.filter((request) => leaveStatusFilter === "All statuses" || request.status === leaveStatusFilter).slice().sort((a, b) => Number(b.status === "Pending") - Number(a.status === "Pending"));
    return `<section class="request-intro"><span class="request-icon">☼</span><div><strong>Leave requests</strong><small>Review team time-off requests and update their status.</small></div><span class="request-pending">${state.leaveRequests.filter((item) => item.status === "Pending").length} pending</span></section>
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Requests</h2><p>Submitted leave and availability requests</p></div><label class="form-field inline-filter"><span>Status</span><select id="leave-status-filter">${["All statuses", "Pending", "Approved", "Declined"].map((status) => `<option ${leaveStatusFilter === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><button class="button button-outline" data-action="print-page">▤ Print requests</button><button class="button button-outline" data-action="add-leave">＋ New request</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>EMPLOYEE</th><th>TYPE</th><th>DATES</th><th>NOTE</th><th>SUBMITTED</th><th>STATUS</th><th></th></tr></thead><tbody>${requests.map((request) => {
        const person = state.team.find((employee) => Number(employee.id) === Number(request.employeeId));
        return `<tr><td><strong>${esc(person?.name || "Former employee")}</strong><small class="table-subline">${esc(person?.role || "")}</small></td><td>${esc(request.type)}</td><td>${formatDateLabel(request.startDate)} – ${formatDateLabel(request.endDate)}</td><td class="request-note">${esc(request.note || "—")}</td><td>${esc(request.submittedAt || "Today")}</td><td><span class="status-badge ${orderStatusClass(request.status)}">${esc(request.status)}</span></td><td>${request.status === "Pending" ? `<div class="row-actions"><button class="button button-small button-soft" data-action="leave-decision" data-status="Approved" data-id="${request.id}">Approve</button><button class="button button-small button-danger" data-action="leave-decision" data-status="Declined" data-id="${request.id}">Decline</button></div>` : "—"}</td></tr>`;
      }).join("") || `<tr><td colspan="7" class="empty-cell">No leave requests yet.</td></tr>`}</tbody></table></div></section>`;
  }

  function renderCoverageRequests() {
    const requests = state.replacementRequests.filter((request) => coverStatusFilter === "All statuses" || request.status === coverStatusFilter).slice().sort((a, b) => Number(b.status === "Pending") - Number(a.status === "Pending"));
    return `<section class="request-intro cover-intro"><span class="request-icon">⇄</span><div><strong>Shift cover &amp; replacements</strong><small>Keep shifts covered when an employee cannot work their scheduled hours.</small></div><span class="request-pending">${state.replacementRequests.filter((item) => item.status === "Pending").length} pending</span></section>
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Cover requests</h2><p>Requested replacements and approval status</p></div><label class="form-field inline-filter"><span>Status</span><select id="cover-status-filter">${["All statuses", "Pending", "Approved", "Declined"].map((status) => `<option ${coverStatusFilter === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><button class="button button-outline" data-action="print-page">▤ Print requests</button><button class="button button-outline" data-action="add-cover">＋ Request cover</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>EMPLOYEE</th><th>SHIFT DATE</th><th>SHIFT</th><th>REPLACEMENT</th><th>REASON</th><th>STATUS</th><th></th></tr></thead><tbody>${requests.map((request) => {
        const person = state.team.find((employee) => Number(employee.id) === Number(request.employeeId));
        const replacement = state.team.find((employee) => Number(employee.id) === Number(request.replacementId));
        return `<tr><td><strong>${esc(person?.name || "Former employee")}</strong></td><td>${formatDateLabel(request.date)}</td><td>${esc(request.shift || "Scheduled shift")}</td><td>${esc(replacement?.name || "Manager to assign")}</td><td class="request-note">${esc(request.reason || "—")}</td><td><span class="status-badge ${orderStatusClass(request.status)}">${esc(request.status)}</span></td><td>${request.status === "Pending" ? `<div class="row-actions"><button class="button button-small button-soft" data-action="cover-decision" data-status="Approved" data-id="${request.id}">Approve</button><button class="button button-small button-danger" data-action="cover-decision" data-status="Declined" data-id="${request.id}">Decline</button></div>` : "—"}</td></tr>`;
      }).join("") || `<tr><td colspan="7" class="empty-cell">No shift cover requests yet.</td></tr>`}</tbody></table></div></section>`;
  }

  function renderReservations() {
    const query = reservationSearch.toLowerCase();
    const bookings = state.reservations.filter((booking) => `${booking.name} ${booking.table}`.toLowerCase().includes(query));
    const assignedTables = new Set(state.reservations.filter((booking) => booking.status !== "Cancelled" && booking.table !== "To be assigned" && booking.table !== "—").map((booking) => booking.table)).size;
    const reservedGuests = state.reservations.filter((booking) => booking.status !== "Cancelled").reduce((sum, booking) => sum + Number(booking.guests), 0);
    return `${pageHeading("FRONT OF HOUSE", "Reservations", "A warm welcome starts before guests walk through the door.", `<div class="heading-actions"><button class="button button-outline" data-action="print-page">▤ Print reservations</button><button class="button button-primary" data-action="add-reservation">＋ New reservation</button></div>`)}
      <div class="reservation-overview"><div class="reservation-date"><span class="date-tile"><strong>${new Date().getDate()}</strong><small>${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date()).toUpperCase()}</small></span><span><strong>Today's service</strong><small>${state.reservations.length} reservations · ${reservedGuests} guests expected</small></span></div><div class="reservation-progress"><span>Tables reserved</span><strong>${assignedTables} <small>of 14 tables</small></strong><div class="capacity-track"><i style="width:${Math.min(100, assignedTables / 14 * 100)}%"></i></div></div></div>
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Guest list</h2><p>${new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date())} · Dinner service</p></div><label class="search-field"><span>⌕</span><input id="reservation-search" type="search" placeholder="Find a guest..." value="${esc(reservationSearch)}"></label></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>GUEST</th><th>TIME</th><th>PARTY SIZE</th><th>TABLE</th><th>PHONE</th><th>STATUS</th><th></th></tr></thead><tbody>${bookings.map((booking) => `<tr><td><div class="customer-cell"><span class="customer-avatar">${esc(initials(booking.name))}</span><strong>${esc(booking.name)}</strong></div></td><td><strong>${esc(booking.time)}</strong></td><td>${booking.guests} guests</td><td>${esc(booking.table)}</td><td>${esc(booking.phone || "—")}</td><td><span class="status-badge ${orderStatusClass(booking.status)}">${esc(booking.status)}</span></td><td><button class="button button-small button-outline" data-action="reservation-status" data-id="${booking.id}">${booking.status === "Seated" ? "Undo" : "Seat"}</button><button class="more-button" data-action="delete-reservation" data-id="${booking.id}" aria-label="Cancel reservation">···</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty-cell">No reservations found.</td></tr>`}</tbody></table></div></section>
      <div class="hint-banner"><span>✦</span><div><strong>Make it personal</strong><small>Add guest notes when taking a reservation to remember allergies, celebrations, and seating preferences.</small></div></div>`;
  }

  function renderReports() {
    const completed = state.orders.filter((order) => order.status === "Completed");
    const completedTotal = completed.reduce((sum, order) => sum + Number(order.total), 0);
    const categoryTotals = state.menu.reduce((totals, item) => {
      const sold = state.orders.reduce((count, order) => count + (order.items || []).filter((line) => Number(line.menuId) === Number(item.id)).reduce((sum, line) => sum + Number(line.quantity), 0), 0);
      totals[item.category] = (totals[item.category] || 0) + sold * item.price;
      return totals;
    }, {});
    const categories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const maxCategory = Math.max(1, ...categories.map(([, total]) => total));
    const topItems = state.menu.map((item) => ({ ...item, sold: state.orders.reduce((sum, order) => sum + (order.items || []).filter((line) => Number(line.menuId) === Number(item.id)).reduce((quantity, line) => quantity + Number(line.quantity), 0), 0) })).sort((a, b) => b.sold - a.sold).slice(0, 5);
    const reportRows = topItems.map((item, index) => `<tr><td><span class="rank-number">${String(index + 1).padStart(2, "0")}</span></td><td><strong>${esc(item.name)}</strong></td><td><span class="category-pill">${esc(item.category)}</span></td><td>${item.sold}</td><td><strong>${money(item.sold * item.price)}</strong></td></tr>`).join("");
    return `${pageHeading("THE BIG PICTURE", "Reports", "Understand what's working and where to focus next.", `<div class="heading-actions"><button class="button button-outline" data-action="print-report">▤ Print report</button><button class="button button-outline" data-action="export">↗ Export report</button></div>`)}
      <div class="report-period"><span class="live-pill"><i></i> LIVE DATA</span><span>Based on your current demo orders and menu</span></div>
      <section class="metrics-grid report-metrics"><article class="metric-card"><div class="metric-top"><span>Completed order sales</span><span class="metric-icon green">↗</span></div><strong class="metric-value">${money(completedTotal)}</strong><div class="metric-foot">${completed.length} completed orders</div></article><article class="metric-card"><div class="metric-top"><span>Average order value</span><span class="metric-icon blue">$</span></div><strong class="metric-value">${money(completed.length ? completedTotal / completed.length : 0)}</strong><div class="metric-foot">Across completed orders</div></article><article class="metric-card"><div class="metric-top"><span>Menu items</span><span class="metric-icon purple">▧</span></div><strong class="metric-value">${state.menu.length}</strong><div class="metric-foot">${new Set(state.menu.map((item) => item.category)).size} menu categories</div></article><article class="metric-card"><div class="metric-top"><span>Low-stock ingredients</span><span class="metric-icon orange">!</span></div><strong class="metric-value">${lowStockItems().length}</strong><div class="metric-foot">Need reorder attention</div></article></section>
      <section class="report-grid"><article class="panel"><div class="panel-heading"><div><h2>Sales by category</h2><p>Sales from recorded orders</p></div></div><div class="category-report">${categories.map(([category, total], index) => `<div class="category-report-row"><div><span class="category-dot dot-${index % 4}"></span><strong>${esc(category)}</strong><span>${money(total)}</span></div><div class="category-track"><i style="width:${Math.max(2, total / maxCategory * 100)}%"></i></div></div>`).join("")}</div></article><article class="panel"><div class="panel-heading"><div><h2>Best sellers</h2><p>Popular dishes by order quantity</p></div></div><div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>#</th><th>ITEM</th><th>CATEGORY</th><th>SOLD</th><th>SALES</th></tr></thead><tbody>${reportRows}</tbody></table></div></article></section>
      <div class="hint-banner"><span>✦</span><div><strong>Prototype reporting</strong><small>Sales totals on this page are calculated from orders in this browser. Connect a payment provider and accounting system for production-ready financial reporting.</small></div></div>`;
  }

  function accountingDates(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);
    if (period === "This week") {
      const start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return { start, end: endOfToday };
    }
    if (period === "This month") return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: endOfToday };
    return { start: null, end: endOfToday };
  }

  function accountingEntries(period = accountingPeriod) {
    const { start, end } = accountingDates(period);
    return state.timeEntries.filter((entry) => {
      const date = new Date(`${entry.date}T12:00:00`);
      return (!start || date >= start) && date <= end;
    });
  }

  function payrollRows(period = accountingPeriod) {
    const totals = new Map(state.team.map((person) => [Number(person.id), { employee: person, hours: 0 }]));
    accountingEntries(period).forEach((entry) => {
      const row = totals.get(Number(entry.employeeId));
      if (row) row.hours += entryHours(entry);
    });
    return [...totals.values()].filter((row) => row.hours > 0).map(({ employee, hours }) => ({
      employee,
      hours,
      rate: Number(employee.hourlyRate) || 0,
      gross: hours * (Number(employee.hourlyRate) || 0),
      payment: (state.wagePayments || []).find((item) => Number(item.employeeId) === Number(employee.id) && item.period === period)
    })).sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  }

  function accountingOrders(period = accountingPeriod) {
    const { start, end } = accountingDates(period);
    const today = localDateKey(new Date());
    return state.orders.filter((order) => {
      const date = new Date(`${order.date || today}T12:00:00`);
      return (!start || date >= start) && date <= end;
    });
  }

  function renderAccounting() {
    state.expenses ||= [];
    state.wagePayments ||= [];
    const payroll = payrollRows();
    const hours = payroll.reduce((sum, item) => sum + item.hours, 0);
    const payrollGross = payroll.reduce((sum, item) => sum + item.gross, 0);
    const paidWages = payroll.filter((item) => item.payment?.status === "Paid").reduce((sum, item) => sum + item.gross, 0);
    const periodExpenses = state.expenses.filter((item) => {
      const { start, end } = accountingDates(accountingPeriod);
      const date = new Date(`${item.date}T12:00:00`);
      return (!start || date >= start) && date <= end;
    });
    const expenseTotal = periodExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const pendingExpenses = periodExpenses.filter((item) => item.status === "Pending").reduce((sum, item) => sum + Number(item.amount), 0);
    const periodOrders = accountingOrders();
    const salesCollected = periodOrders.filter((order) => order.payment === "Paid").reduce((sum, order) => sum + Number(order.total), 0);
    const unpaidSales = periodOrders.filter((order) => order.payment !== "Paid").reduce((sum, order) => sum + Number(order.total), 0);
    const salesRows = periodOrders.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((order) => `<tr><td>${formatDateLabel(order.date || localDateKey(new Date()))} · ${esc(order.createdAt)}</td><td><strong>#${order.id}</strong></td><td>${esc(order.customer)}</td><td><span class="category-pill">${esc(order.type)}</span></td><td><strong>${money(order.total)}</strong></td><td><span class="status-badge ${order.payment === "Paid" ? "completed" : "preparing"}">${esc(order.payment)}</span></td><td>${order.payment === "Paid" ? "—" : `<button class="button button-small button-soft" data-action="sale-paid" data-id="${order.id}">Record paid</button>`}</td></tr>`).join("");
    const wageRows = payroll.map((row) => `<tr><td><div class="employee-name-cell"><span class="team-avatar ${esc(row.employee.color)}">${esc(row.employee.initials)}</span><strong>${esc(row.employee.name)}</strong></div></td><td>${esc(row.employee.role)}</td><td>${row.hours.toFixed(2)} hrs</td><td>${money(row.rate)} / hr</td><td><strong>${money(row.gross)}</strong></td><td>${money(row.gross * .0765)} <small class="table-subline">estimated tax</small></td><td><span class="status-badge ${row.payment?.status === "Paid" ? "completed" : "preparing"}">${row.payment?.status || "Unpaid"}</span></td><td>${row.payment?.status === "Paid" ? "—" : `<button class="button button-small button-soft" data-action="pay-wage" data-id="${row.employee.id}">Record paid</button>`}</td></tr>`).join("");
    return `${pageHeading("FINANCE &amp; PAYROLL", "Accounting", "Track payroll from employee timesheets, record expenses, and review cash outflows.", `<div class="heading-actions"><button class="button button-outline" data-action="print-page">▤ Print accounts</button><button class="button button-primary" data-action="add-expense">＋ Add expense</button></div>`)}
      <div class="accounting-toolbar"><div class="filter-tabs">${["This week", "This month", "All time"].map((period) => `<button class="filter-tab ${accountingPeriod === period ? "active" : ""}" data-action="accounting-period" data-period="${period}">${period}</button>`).join("")}</div><span class="prototype-note">Local demo ledger · not connected to a bank or payroll provider</span></div>
      <section class="accounting-metrics"><article><span>Sales collected</span><strong>${money(salesCollected)}</strong><small>${periodOrders.filter((order) => order.payment === "Paid").length} paid orders</small></article><article><span>Gross wages</span><strong>${money(payrollGross)}</strong><small>${hours.toFixed(2)} recorded hours</small></article><article><span>Operating expenses</span><strong>${money(expenseTotal)}</strong><small>${periodExpenses.length} recorded expenses</small></article><article><span>Unpaid balances</span><strong>${money(unpaidSales + payrollGross - paidWages + pendingExpenses)}</strong><small>Guest bills + payroll + expenses</small></article></section>
      <div class="accounting-callout"><span>i</span><p><strong>Prototype accounting only.</strong> Payroll taxes are estimates, and “Record paid” updates the demo ledger only. Real payroll, tax filing, bank reconciliation, and statutory reporting require a connected accounting/payroll service.</p></div>
      <section class="panel table-panel accounting-section"><div class="table-toolbar"><div><h2>Sales &amp; customer payments</h2><p>Order payments synced from the live Orders page · ${money(salesCollected)} collected, ${money(unpaidSales)} outstanding.</p></div><button class="button button-outline" data-action="print-section" data-print="sales-section">Print sales</button></div><div class="table-scroll" id="sales-section"><table class="data-table"><thead><tr><th>DATE / TIME</th><th>ORDER</th><th>CUSTOMER</th><th>TYPE</th><th>AMOUNT</th><th>PAYMENT</th><th></th></tr></thead><tbody>${salesRows || `<tr><td colspan="7" class="empty-cell">No orders in this accounting period.</td></tr>`}</tbody></table></div></section>
      <section class="panel table-panel accounting-section"><div class="table-toolbar"><div><h2>Employee payroll</h2><p>Hours × each employee’s saved hourly rate. Uses real recorded time entries.</p></div><button class="button button-outline" data-action="print-section" data-print="payroll-section">Print payroll</button></div><div class="table-scroll" id="payroll-section"><table class="data-table payroll-table"><thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>HOURS</th><th>HOURLY RATE</th><th>GROSS PAY</th><th>EST. EMPLOYER TAX</th><th>PAYMENT</th><th></th></tr></thead><tbody>${wageRows || `<tr><td colspan="8" class="empty-cell">No time entries in this accounting period.</td></tr>`}</tbody><tfoot><tr><td colspan="2"><strong>Period total</strong></td><td><strong>${hours.toFixed(2)} hrs</strong></td><td>—</td><td><strong>${money(payrollGross)}</strong></td><td><strong>${money(payrollGross * .0765)}</strong></td><td colspan="2"></td></tr></tfoot></table></div></section>
      <section class="panel table-panel accounting-section"><div class="table-toolbar"><div><h2>Operating expenses</h2><p>Food purchases, utilities, cleaning, and other costs.</p></div><label class="form-field inline-filter"><span>Category</span><select id="expense-category-filter"><option>All categories</option>${[...new Set(state.expenses.map((item) => item.category))].map((category) => `<option ${expenseCategory === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label><button class="button button-outline" data-action="print-section" data-print="expense-section">Print expenses</button></div><div class="table-scroll" id="expense-section"><table class="data-table"><thead><tr><th>DATE</th><th>VENDOR / DESCRIPTION</th><th>CATEGORY</th><th>METHOD</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>${(expenseCategory === "All categories" ? periodExpenses : periodExpenses.filter((item) => item.category === expenseCategory)).map((item) => `<tr><td>${formatDateLabel(item.date)}</td><td><strong>${esc(item.vendor)}</strong><small class="table-subline">${esc(item.description)}</small></td><td><span class="category-pill">${esc(item.category)}</span></td><td>${esc(item.paymentMethod || "—")}</td><td><strong>${money(item.amount)}</strong></td><td><span class="status-badge ${item.status === "Paid" ? "completed" : "preparing"}">${esc(item.status)}</span></td><td>${item.status === "Pending" ? `<button class="button button-small button-soft" data-action="expense-paid" data-id="${item.id}">Mark paid</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="empty-cell">No expenses in this period or category.</td></tr>`}</tbody></table></div></section>`;
  }

  function renderComplaints() {
    state.complaints ||= [];
    const filtered = state.complaints.filter((complaint) => (complaintStatusFilter === "All statuses" || complaint.status === complaintStatusFilter) && (complaintSeverityFilter === "All priorities" || complaint.severity === complaintSeverityFilter));
    const openCount = state.complaints.filter((item) => item.status !== "Resolved").length;
    const rows = filtered.slice().sort((a, b) => b.date.localeCompare(a.date)).map((complaint) => {
      const person = state.team.find((employee) => Number(employee.id) === Number(complaint.employeeId));
      return `<tr><td>${formatDateLabel(complaint.date)}<small class="table-subline">${esc(complaint.submittedAt || "")}</small></td><td><strong>${esc(person?.name || "Former employee")}</strong><small class="table-subline">${esc(person?.role || "")}</small></td><td><span class="category-pill">${esc(complaint.category)}</span></td><td><strong>${esc(complaint.subject)}</strong><small class="table-subline complaint-details">${esc(complaint.details)}</small></td><td><span class="status-badge ${complaint.severity === "High" ? "low-stock" : complaint.severity === "Medium" ? "preparing" : "in-stock"}">${esc(complaint.severity)}</span></td><td><span class="status-badge ${orderStatusClass(complaint.status)}">${esc(complaint.status)}</span></td><td>${complaint.status !== "Resolved" ? `<button class="button button-small button-soft" data-action="resolve-complaint" data-id="${complaint.id}">Resolve</button>` : "—"}</td></tr>`;
    }).join("");
    return `${pageHeading("PEOPLE &amp; WORKPLACE", "Employee complaints", "A private register for workplace concerns, safety issues, and employee feedback.", `<div class="heading-actions"><button class="button button-outline" data-action="print-page">▤ Print list</button><button class="button button-primary" data-action="add-complaint">＋ Log complaint</button></div>`)}
      <section class="accounting-metrics complaint-metrics"><article><span>Total complaints</span><strong>${state.complaints.length}</strong><small>Demo register</small></article><article><span>Open / in review</span><strong>${openCount}</strong><small>Require follow-up</small></article><article><span>High priority</span><strong>${state.complaints.filter((item) => item.severity === "High" && item.status !== "Resolved").length}</strong><small>Safety or urgent concerns</small></article><article><span>Resolved</span><strong>${state.complaints.filter((item) => item.status === "Resolved").length}</strong><small>Closed cases</small></article></section>
      <div class="accounting-toolbar"><label class="form-field inline-filter"><span>Status</span><select id="complaint-status-filter">${["All statuses", "Open", "In review", "Resolved"].map((status) => `<option ${complaintStatusFilter === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label class="form-field inline-filter"><span>Priority</span><select id="complaint-severity-filter">${["All priorities", "High", "Medium", "Low"].map((severity) => `<option ${complaintSeverityFilter === severity ? "selected" : ""}>${severity}</option>`).join("")}</select></label><span class="prototype-note">Demo data · handle employee concerns confidentially</span></div>
      <section class="panel table-panel"><div class="table-toolbar"><div><h2>Complaint register</h2><p>${filtered.length} cases match the selected filters</p></div></div><div class="table-scroll"><table class="data-table complaint-table"><thead><tr><th>DATE</th><th>EMPLOYEE</th><th>TYPE</th><th>CONCERN</th><th>PRIORITY</th><th>STATUS</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="empty-cell">No complaints match these filters.</td></tr>`}</tbody></table></div></section>`;
  }

  function updateLiveClock() {
    const now = new Date();
    const dateText = `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(now)} · ${timeNow()}`;
    const topDate = document.getElementById("today-label");
    if (topDate) topDate.textContent = dateText;
    const dashboardClock = document.getElementById("dashboard-clock");
    if (dashboardClock) dashboardClock.textContent = timeNow();
    const teamClock = document.getElementById("team-live-clock");
    if (teamClock) teamClock.textContent = timeNow();
    const kitchenClock = document.getElementById("kitchen-live-clock");
    if (kitchenClock) kitchenClock.textContent = timeNow();
    document.querySelectorAll("[data-elapsed]").forEach((element) => {
      const start = new Date(element.dataset.elapsed);
      if (Number.isNaN(start.getTime())) return;
      const minutes = Math.max(0, Math.floor((now - start) / 60000));
      element.textContent = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m elapsed`;
    });
    document.querySelectorAll(".shift-card[data-employee-id]").forEach((card) => {
      const person = state.team.find((employee) => Number(employee.id) === Number(card.dataset.employeeId));
      const progress = card.querySelector(".shift-progress i");
      if (person && progress && person.status === "On shift") progress.style.width = `${shiftProgress(person)}%`;
    });
  }

  function openModal(title, body, size = "") {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${title}</h2></div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></header><div class="modal-body">${body}</div></section></div>`;
    modalRoot.querySelector(".modal-backdrop").addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
    const firstInput = modalRoot.querySelector("input, select, button");
    if (firstInput) firstInput.focus();
  }

  function closeModal() {
    modalRoot.innerHTML = "";
  }

  function field(label, name, value = "", type = "text", required = false, extra = "") {
    return `<label class="form-field"><span>${label}${required ? " <i>*</i>" : ""}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${extra}></label>`;
  }

  function openNewOrder() {
    const rows = state.menu.map((item) => `<label class="order-menu-item"><span class="order-item-info"><strong>${esc(item.name)}</strong><small>${money(item.price)} · ${esc(item.category)}</small></span><input type="number" name="qty_${item.id}" min="0" max="99" value="0" aria-label="Quantity of ${esc(item.name)}"></label>`).join("");
    openModal("Start a new order", `<form id="new-order-form"><div class="form-grid">${field("Order type", "type", "Dine in", "text", true, "list=\"order-types\"")}<datalist id="order-types"><option>Dine in</option><option>Takeaway</option><option>Delivery</option></datalist>${field("Customer name", "customer", "", "text", true)}<div class="form-field"><span>Table</span><select name="table"><option>—</option>${Array.from({ length: 14 }, (_, index) => `<option>Table ${String(index + 1).padStart(2, "0")}</option>`).join("")}</select></div></div><div class="modal-section-heading"><div><h3>Add items</h3><p>Enter a quantity for each item.</p></div><span>${state.menu.length} items</span></div><div class="order-menu-list">${rows || `<div class="empty-state compact">Add menu items before creating an order.</div>`}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Create order</button></div></form>`, "modal-wide");
  }

  function openMenuForm(item = null) {
    const editing = Boolean(item);
    const categories = ["Starters", "Mains", "Sides", "Desserts", "Drinks"];
    const options = categories.map((category) => `<option ${item?.category === category ? "selected" : ""}>${category}</option>`).join("");
    const image = safeImage(item?.image);
    openModal(editing ? "Edit menu item" : "Add menu item", `<form id="menu-form" data-id="${item?.id || ""}"><div class="form-grid">${field("Item name", "name", item?.name || "", "text", true)}${field("Price", "price", item?.price ?? "", "number", true, 'min="0.01" step="0.01"')}<label class="form-field"><span>Category</span><select name="category">${options}</select></label>${field("Description", "description", item?.description || "")}</div><div class="image-upload-section"><div><strong>Food photo</strong><small>Upload a JPG, PNG, or WebP image (up to 10 MB).</small></div><div class="image-upload-control"><div class="upload-preview ${image ? "has-image" : ""}" id="menu-image-preview">${image ? `<img src="${esc(image)}" alt="Menu item preview">` : `<span>✦</span>`}</div><label class="button button-outline upload-button" for="menu-image-file">Upload photo<input id="menu-image-file" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${image ? `<label class="remove-image-check"><input name="removeImage" type="checkbox"><span>Remove current photo</span></label>` : ""}</div></div><label class="check-field"><input type="checkbox" name="popular" ${item?.popular ? "checked" : ""}><span>Mark as a popular item</span></label><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${editing ? "Save changes" : "Add to menu"}</button></div></form>`);
  }

  function openIngredientForm() {
    openModal("Add ingredient", `<form id="ingredient-form"><div class="form-grid">${field("Ingredient name", "name", "", "text", true)}<label class="form-field"><span>Category</span><select name="category">${["Produce", "Dairy", "Meat & seafood", "Dry goods", "Bakery", "Beverages", "Other"].map((item) => `<option>${item}</option>`).join("")}</select></label>${field("Unit", "unit", "kg", "text", true)}${field("Starting stock", "stock", "0", "number", true, 'min="0" step="0.01"')}${field("Reorder at", "reorderAt", "1", "number", true, 'min="0" step="0.01"')}${field("Unit cost ($)", "cost", "0", "number", true, 'min="0" step="0.01"')}${field("Supplier", "supplier", "", "text", true)}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Add ingredient</button></div></form>`);
  }

  function openStockAdjustment(item) {
    openModal("Adjust stock", `<div class="adjustment-context"><span class="ingredient-icon">◈</span><span><strong>${esc(item.name)}</strong><small>Currently ${item.stock} ${esc(item.unit)} in stock</small></span></div><form id="stock-form" data-id="${item.id}"><div class="form-grid"><label class="form-field"><span>Adjustment</span><select name="kind"><option value="add">Stock received (+)</option><option value="remove">Stock used / waste (−)</option></select></label>${field(`Quantity (${esc(item.unit)})`, "quantity", "", "number", true, 'min="0.01" step="0.01"')}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save adjustment</button></div></form>`);
  }

  function openTeamForm(person = null) {
    const editing = Boolean(person);
    const status = person?.status || "Upcoming";
    const roles = ["Waiter", "Head chef", "Sous chef", "Floor manager", "Bartender", "Host", "Dishwasher", "Kitchen porter"];
    const roleOptions = roles.map((role) => `<option ${person?.role === role ? "selected" : ""}>${role}</option>`).join("");
    const typeOptions = ["Full time", "Part time", "Casual"].map((type) => `<option ${person?.employmentType === type ? "selected" : ""}>${type}</option>`).join("");
    openModal(editing ? "Edit employee" : "Add employee", `<form id="team-form" data-id="${person?.id || ""}"><div class="form-grid">${field("Full name", "name", person?.name || "", "text", true)}<label class="form-field"><span>Role</span><select name="role" required>${roleOptions}</select></label>${field("Email", "email", person?.email || "", "email")}${field("Phone", "phone", person?.phone || "", "tel")}${field("Shift starts", "shiftStart", person?.shiftStart || "15:00", "time", true)}${field("Shift ends", "shiftEnd", person?.shiftEnd || "23:00", "time", true)}${field("Break (minutes)", "breakMinutes", person?.breakMinutes ?? 30, "number", true, 'min="0" max="240" step="5"')}${field("Station / section", "station", person?.station || "", "text", true)}${field("Hourly rate ($)", "hourlyRate", person?.hourlyRate ?? 15, "number", true, 'min="0" step="0.25"')}<label class="form-field"><span>Employment type</span><select name="employmentType">${typeOptions}</select></label><label class="form-field"><span>Shift status</span><select name="status"><option ${status === "Upcoming" ? "selected" : ""}>Upcoming</option><option ${status === "On shift" ? "selected" : ""}>On shift</option><option ${status === "Completed" ? "selected" : ""}>Completed</option></select></label></div><div class="modal-footer">${editing ? `<button type="button" class="button button-danger" data-action="delete-employee" data-id="${person.id}">Remove employee</button>` : ""}<button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${editing ? "Save employee" : "Add employee"}</button></div></form>`);
  }

  function openReservationForm() {
    openModal("New reservation", `<form id="reservation-form"><div class="form-grid">${field("Guest name", "name", "", "text", true)}${field("Phone number", "phone", "", "tel", true)}${field("Time", "time", "6:00 PM", "text", true)}<label class="form-field"><span>Party size</span><select name="guests">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i === 1 ? "selected" : ""}>${i + 1} ${i === 0 ? "guest" : "guests"}</option>`).join("")}</select></label><label class="form-field"><span>Table</span><select name="table"><option>To be assigned</option>${Array.from({ length: 14 }, (_, index) => `<option>Table ${String(index + 1).padStart(2, "0")}</option>`).join("")}</select></label></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Add reservation</button></div></form>`);
  }

  function openTimeEntryForm(entry = null) {
    const personOptions = state.team.map((person) => `<option value="${person.id}" ${Number(entry?.employeeId) === Number(person.id) ? "selected" : ""}>${esc(person.name)} · ${esc(person.role)}</option>`).join("");
    const date = entry?.date || localDateKey(new Date());
    const startTime = entry?.clockIn ? `${String(new Date(entry.clockIn).getHours()).padStart(2, "0")}:${String(new Date(entry.clockIn).getMinutes()).padStart(2, "0")}` : "15:00";
    const endTime = entry?.clockOut ? `${String(new Date(entry.clockOut).getHours()).padStart(2, "0")}:${String(new Date(entry.clockOut).getMinutes()).padStart(2, "0")}` : "";
    openModal(entry ? "Edit time entry" : "Add time entry", `<form id="time-entry-form" data-id="${esc(entry?.id || "")}"><div class="form-grid"><label class="form-field"><span>Employee</span><select name="employeeId" required>${personOptions}</select></label>${field("Shift date", "date", date, "date", true)}${field("Clock in", "clockIn", startTime, "time", true)}${field("Clock out", "clockOut", endTime, "time", false)}${field("Unpaid break (minutes)", "breakMinutes", entry?.breakMinutes ?? 30, "number", true, 'min="0" max="240" step="5')}</div><p class="form-help">Leave clock-out blank to keep this shift open and continue tracking time.</p><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save time entry</button></div></form>`);
  }

  function openLeaveRequestForm() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const end = new Date(start);
    const people = state.team.map((person) => `<option value="${person.id}">${esc(person.name)} · ${esc(person.role)}</option>`).join("");
    openModal("Request time off", `<form id="leave-form"><div class="form-grid"><label class="form-field"><span>Employee</span><select name="employeeId" required>${people}</select></label><label class="form-field"><span>Leave type</span><select name="type"><option>Paid time off</option><option>Unpaid leave</option><option>Sick leave</option><option>Personal day</option></select></label>${field("Start date", "startDate", localDateKey(start), "date", true)}${field("End date", "endDate", localDateKey(end), "date", true)}${field("Reason / note", "note", "", "text")}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Submit request</button></div></form>`);
  }

  function openCoverRequestForm() {
    const people = state.team.map((person) => `<option value="${person.id}">${esc(person.name)} · ${esc(person.role)}</option>`).join("");
    openModal("Request shift cover", `<form id="cover-form"><div class="form-grid"><label class="form-field"><span>Employee requesting cover</span><select name="employeeId" required>${people}</select></label><label class="form-field"><span>Suggested replacement</span><select name="replacementId"><option value="">Manager to assign</option>${people}</select></label>${field("Shift date", "date", localDateKey(new Date()), "date", true)}<label class="form-field"><span>Reason</span><select name="reason"><option>Schedule conflict</option><option>Personal commitment</option><option>Illness</option><option>Other</option></select></label></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Submit cover request</button></div></form>`);
  }

  function openExpenseForm() {
    openModal("Record an expense", `<form id="expense-form"><div class="form-grid">${field("Vendor", "vendor", "", "text", true)}<label class="form-field"><span>Category</span><select name="category">${["Food & beverage", "Payroll & benefits", "Utilities", "Rent", "Cleaning", "Equipment", "Marketing", "Other"].map((item) => `<option>${item}</option>`).join("")}</select></label>${field("Description", "description", "", "text", true)}${field("Amount ($)", "amount", "", "number", true, 'min="0.01" step="0.01"')}${field("Date", "date", localDateKey(new Date()), "date", true)}<label class="form-field"><span>Payment method</span><select name="paymentMethod"><option>Business card</option><option>Bank transfer</option><option>Direct debit</option><option>Cash</option><option>Other</option></select></label><label class="form-field"><span>Status</span><select name="status"><option>Pending</option><option>Paid</option></select></label></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save expense</button></div></form>`);
  }

  function openComplaintForm() {
    const employees = state.team.map((person) => `<option value="${person.id}">${esc(person.name)} · ${esc(person.role)}</option>`).join("");
    openModal("Log employee complaint", `<form id="complaint-form"><div class="form-grid"><label class="form-field"><span>Employee</span><select name="employeeId" required>${employees}</select></label><label class="form-field"><span>Category</span><select name="category">${["Workplace", "Scheduling", "Pay & benefits", "Equipment", "Safety", "Management", "Other"].map((item) => `<option>${item}</option>`).join("")}</select></label>${field("Subject", "subject", "", "text", true)}<label class="form-field"><span>Priority</span><select name="severity"><option>Low</option><option selected>Medium</option><option>High</option></select></label><label class="form-field full-span"><span>Details</span><textarea name="details" rows="4" required placeholder="Record the concern and any relevant context."></textarea></label></div><div class="form-help">Limit access to managers. For emergencies or immediate safety risks, follow your restaurant's incident procedure.</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save complaint</button></div></form>`);
  }

  function printSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (!element) {
      showToast("That report section could not be found.");
      return;
    }
    const panel = element.closest(".panel") || element;
    panel.classList.add("print-target");
    document.body.classList.add("print-focus");
    const cleanup = () => {
      panel.classList.remove("print-target");
      document.body.classList.remove("print-focus");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  function compressImage(file) {
    if (!file.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return Promise.reject(new Error("Choose a JPG, PNG, or WebP image."));
    }
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("Choose an image smaller than 10 MB."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The selected image could not be read."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("The selected image could not be decoded."));
        image.onload = () => {
          const scale = Math.min(1, 1000 / image.width, 720 / image.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Your browser could not prepare the image."));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const compressed = canvas.toDataURL("image/webp", 0.78);
          if (compressed.length > 900000) {
            reject(new Error("This photo is still too large after compression. Try a smaller image."));
            return;
          }
          resolve(compressed);
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function applyInventory(order, direction) {
    (order.items || []).forEach((line) => {
      const menuItem = findMenuItem(line.menuId);
      (menuItem?.recipe || []).forEach((ingredient) => {
        const stockItem = state.inventory.find((entry) => Number(entry.id) === Number(ingredient.ingredientId));
        if (stockItem) stockItem.stock = Math.max(0, Number((stockItem.stock + direction * ingredient.quantity * line.quantity).toFixed(3)));
      });
    });
  }

  function createOrder(form) {
    const data = new FormData(form);
    const items = state.menu.map((item) => ({ menuId: item.id, quantity: Math.max(0, Number(data.get(`qty_${item.id}`)) || 0) })).filter((item) => item.quantity > 0);
    if (!items.length) {
      showToast("Add at least one menu item to the order.");
      return;
    }
    for (const line of items) {
      const menuItem = findMenuItem(line.menuId);
      for (const recipePart of menuItem?.recipe || []) {
        const stockItem = state.inventory.find((entry) => Number(entry.id) === Number(recipePart.ingredientId));
        const required = recipePart.quantity * line.quantity;
        if (stockItem && stockItem.stock < required) {
          showToast(`Not enough ${stockItem.name} in stock for this order.`);
          return;
        }
      }
    }
    const total = items.reduce((sum, line) => sum + findMenuItem(line.menuId).price * line.quantity, 0);
    const type = String(data.get("type")).trim();
    const order = {
      id: Math.max(1000, ...state.orders.map((item) => Number(item.id) || 0)) + 1,
      type: ["Dine in", "Takeaway", "Delivery"].includes(type) ? type : "Dine in",
      table: type === "Dine in" ? String(data.get("table")) : "—",
      customer: String(data.get("customer")).trim(),
      items,
      total,
      status: "Preparing",
      payment: "Unpaid",
      createdAt: timeNow(),
      date: localDateKey(new Date()),
      stockApplied: true
    };
    applyInventory(order, -1);
    state.orders.unshift(order);
    addNotification("order", "New order sent to kitchen", `Order #${order.id} · ${order.customer} · ${money(order.total)}`);
    saveState();
    closeModal();
    view = "orders";
    render();
    showToast(`Order #${order.id} sent to the kitchen.`);
  }

  function exportData() {
    const file = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "juniper-table-backup.json";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Restaurant data backup exported.");
  }

  function exportOrders() {
    const rows = [["Order", "Customer", "Type", "Table", "Time", "Status", "Payment", "Total"], ...state.orders.map((order) => [order.id, order.customer, order.type, order.table, order.createdAt, order.status, order.payment, order.total])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "juniper-table-orders.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Orders exported as CSV.");
  }

  function downloadTeam() {
    const rows = [["Name", "Role", "Email", "Phone", "Employment type", "Shift", "Station", "Break (minutes)", "Paid hours", "Status"], ...state.team.map((person) => [person.name, person.role, person.email || "", person.phone || "", person.employmentType || "", `${formatShiftTime(person.shiftStart)} – ${formatShiftTime(person.shiftEnd)}`, person.station || "", person.breakMinutes || 0, shiftLength(person).toFixed(1), person.status])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "juniper-table-team.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Team schedule exported.");
  }

  function downloadTimesheets() {
    const rows = [["Date", "Employee", "Role", "Clock in", "Clock out", "Break minutes", "Paid hours"], ...state.timeEntries.map((entry) => {
      const person = state.team.find((employee) => Number(employee.id) === Number(entry.employeeId));
      return [entry.date, person?.name || "Removed employee", person?.role || "", formatEntryTime(entry.clockIn), entry.clockOut ? formatEntryTime(entry.clockOut) : "Still clocked in", entry.breakMinutes || 0, entryHours(entry).toFixed(2)];
    })];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "juniper-table-timesheets.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Timesheets exported.");
  }

  function clockEmployee(person) {
    const today = localDateKey(new Date());
    if (person.status === "On shift") {
      const entry = state.timeEntries.find((item) => Number(item.employeeId) === Number(person.id) && item.date === today && !item.clockOut);
      if (entry) entry.clockOut = new Date().toISOString();
      person.clockedOutAt = new Date().toISOString();
      person.status = "Completed";
      saveState(); render(); showToast(`${person.name} clocked out at ${timeNow()}.`);
    } else if (person.status === "Upcoming") {
      const now = new Date().toISOString();
      person.clockedInAt = now;
      person.status = "On shift";
      delete person.clockedOutAt;
      state.timeEntries.push({ id: `time-${person.id}-${Date.now()}`, employeeId: person.id, date: today, clockIn: now, clockOut: null, breakMinutes: 0 });
      saveState(); render(); showToast(`${person.name} clocked in at ${timeNow()}.`);
    }
  }

  function decideRequest(collection, requestId, status) {
    const request = collection.find((item) => Number(item.id) === Number(requestId));
    if (!request || request.status !== "Pending") return;
    request.status = status;
    request.reviewedAt = timeNow();
    saveState();
    render();
    showToast(`${status === "Approved" ? "Request approved" : "Request declined"}.`);
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-view], [data-action]");
    if (!target) return;
    if (target.dataset.view) {
      event.preventDefault();
      closeModal();
      view = target.dataset.view;
      render();
      return;
    }
    const { action, id } = target.dataset;
    if (action === "close-modal") closeModal();
    else if (action === "new-order") openNewOrder();
    else if (action === "add-menu") openMenuForm();
    else if (action === "edit-menu") openMenuForm(findMenuItem(id));
    else if (action === "delete-menu") {
      const item = findMenuItem(id);
      if (item && window.confirm(`Remove "${item.name}" from the menu?`)) {
        state.menu = state.menu.filter((entry) => Number(entry.id) !== Number(id));
        saveState(); render(); showToast("Menu item removed.");
      }
    } else if (action === "menu-filter") {
      menuFilter = target.dataset.filter; render();
    } else if (action === "team-day") {
      selectedTeamDay = Number(target.dataset.day);
      render();
    } else if (action === "employee-tab") {
      employeeTab = target.dataset.tab;
      render();
    } else if (action === "timesheet-day") {
      const next = new Date(timesheetDate);
      next.setDate(next.getDate() + Number(target.dataset.delta));
      timesheetDate = next;
      render();
    } else if (action === "kitchen-filter") {
      kitchenFilter = target.dataset.filter;
      render();
    } else if (action === "kitchen-status") {
      const order = state.orders.find((entry) => Number(entry.id) === Number(id));
      if (order) {
        if (order.status === "Completed") order.payment = "Paid";
        else {
          order.status = order.status === "Preparing" ? "Cooking" : order.status === "Cooking" ? "Ready" : "Completed";
          if (order.status === "Completed") order.payment = "Paid";
        }
        saveState(); render(); showToast(`Order #${order.id} moved to ${order.status.toLowerCase()}.`);
      }
    } else if (action === "accounting-period") {
      accountingPeriod = target.dataset.period;
      render();
    } else if (action === "expense-paid") {
      const expense = state.expenses.find((item) => Number(item.id) === Number(id));
      if (expense) {
        expense.status = "Paid";
        expense.paidDate = localDateKey(new Date());
        saveState(); render(); showToast(`${expense.vendor} expense recorded as paid.`);
      }
    } else if (action === "sale-paid") {
      const order = state.orders.find((item) => Number(item.id) === Number(id));
      if (order && order.payment !== "Paid") {
        order.payment = "Paid";
        order.paidDate = localDateKey(new Date());
        saveState(); render(); showToast(`Payment for order #${order.id} recorded.`);
      }
    } else if (action === "pay-wage") {
      const employeeId = Number(id);
      const row = payrollRows().find((item) => Number(item.employee.id) === employeeId);
      if (row && !row.payment && row.gross > 0) {
        state.wagePayments.push({ id: Date.now(), employeeId, period: accountingPeriod, amount: Number(row.gross.toFixed(2)), status: "Paid", paidDate: localDateKey(new Date()), method: "Payroll transfer" });
        saveState(); render(); showToast(`Payroll payment for ${row.employee.name} recorded.`);
      }
    } else if (action === "print-page") {
      window.print();
    } else if (action === "print-section") {
      printSection(target.dataset.print);
    } else if (action === "add-expense") {
      openExpenseForm();
    } else if (action === "add-complaint") {
      openComplaintForm();
    } else if (action === "resolve-complaint") {
      const complaint = state.complaints.find((item) => Number(item.id) === Number(id));
      if (complaint) {
        complaint.status = "Resolved";
        complaint.resolvedAt = timeNow();
        saveState(); render(); showToast("Complaint marked resolved.");
      }
    } else if (action === "order-filter") {
      orderFilter = target.dataset.filter; render();
    } else if (action === "advance-order") {
      const order = state.orders.find((entry) => Number(entry.id) === Number(id));
      if (order) {
        order.status = order.status === "Preparing" ? "Cooking" : order.status === "Cooking" ? "Ready" : "Completed";
        if (order.status === "Completed") order.payment = "Paid";
        saveState(); render(); showToast(`Order #${order.id} marked ${order.status.toLowerCase()}.`);
      }
    } else if (action === "order-menu") {
      const order = state.orders.find((entry) => Number(entry.id) === Number(id));
      if (order) {
        const next = order.status === "Preparing" ? "Start cooking" : order.status === "Cooking" ? "Mark ready" : order.status === "Ready" ? "Complete order" : order.status === "Completed" && order.payment !== "Paid" ? "Record payment" : "";
        const cancel = order.status === "Cancelled" || order.status === "Completed" ? "" : `<button class="button button-danger" data-action="cancel-order" data-id="${order.id}">Cancel order</button>`;
        openModal(`Order #${order.id}`, `<div class="order-detail"><div class="order-detail-line"><span>Customer</span><strong>${esc(order.customer)}</strong></div><div class="order-detail-line"><span>Order type</span><strong>${esc(order.type)} ${order.table !== "—" ? `· ${esc(order.table)}` : ""}</strong></div><div class="order-detail-line"><span>Status</span><strong>${esc(order.status)}</strong></div><div class="order-detail-line"><span>Payment</span><strong>${esc(order.payment)}</strong></div><hr>${order.items.map((line) => `<div class="order-detail-line"><span>${line.quantity} × ${esc(findMenuItem(line.menuId)?.name || "Menu item")}</span><strong>${money((findMenuItem(line.menuId)?.price || 0) * line.quantity)}</strong></div>`).join("")}<div class="order-detail-total"><span>Total</span><strong>${money(order.total)}</strong></div></div><div class="modal-footer">${cancel}<button class="button button-outline" data-action="close-modal">Close</button>${next ? `<button class="button button-primary" data-action="advance-order" data-id="${order.id}">${next}</button>` : ""}</div>`);
      }
    } else if (action === "cancel-order") {
      const order = state.orders.find((entry) => Number(entry.id) === Number(id));
      if (order && order.status !== "Cancelled") {
        if (order.stockApplied) applyInventory(order, 1);
        order.stockApplied = false;
        order.status = "Cancelled";
        saveState(); closeModal(); render(); showToast(`Order #${order.id} cancelled and ingredients returned to stock.`);
      }
    } else if (action === "add-ingredient") openIngredientForm();
    else if (action === "adjust-stock") {
      const ingredient = state.inventory.find((entry) => Number(entry.id) === Number(id));
      if (ingredient) openStockAdjustment(ingredient);
    } else if (action === "reorder-list") {
      inventorySearch = "";
      render();
      document.querySelector(".inventory-alert")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (action === "add-team") openTeamForm();
    else if (action === "edit-team") {
      const person = state.team.find((entry) => Number(entry.id) === Number(id));
      if (person) openTeamForm(person);
    } else if (action === "delete-employee") {
      const person = state.team.find((entry) => Number(entry.id) === Number(id));
      if (person && window.confirm(`Remove ${person.name} from the employee directory? Their existing timesheets and requests will be kept.`)) {
        state.team = state.team.filter((employee) => Number(employee.id) !== Number(id));
        saveState(); closeModal(); render(); showToast(`${person.name} removed from the active employee directory.`);
      }
    } else if (action === "toggle-team") {
      const person = state.team.find((entry) => Number(entry.id) === Number(id));
      if (person) clockEmployee(person);
    } else if (action === "add-reservation") openReservationForm();
    else if (action === "add-leave") openLeaveRequestForm();
    else if (action === "add-cover") openCoverRequestForm();
    else if (action === "add-time-entry") openTimeEntryForm();
    else if (action === "edit-time-entry") {
      const entry = state.timeEntries.find((item) => String(item.id) === String(id));
      if (entry) openTimeEntryForm(entry);
    } else if (action === "leave-decision") decideRequest(state.leaveRequests, id, target.dataset.status);
    else if (action === "cover-decision") decideRequest(state.replacementRequests, id, target.dataset.status);
    else if (action === "reservation-status") {
      const booking = state.reservations.find((entry) => Number(entry.id) === Number(id));
      if (booking) {
        booking.status = booking.status === "Seated" ? "Confirmed" : "Seated";
        saveState(); render(); showToast(`${booking.name} is ${booking.status.toLowerCase()}.`);
      }
    } else if (action === "delete-reservation") {
      const booking = state.reservations.find((entry) => Number(entry.id) === Number(id));
      if (booking && window.confirm(`Cancel the reservation for ${booking.name}?`)) {
        state.reservations = state.reservations.filter((entry) => Number(entry.id) !== Number(id));
        saveState(); render(); showToast("Reservation cancelled.");
      }
    } else if (action === "export") exportData();
    else if (action === "export-orders") exportOrders();
    else if (action === "export-team") downloadTeam();
    else if (action === "export-timesheets") downloadTimesheets();
    else if (action === "print-report") window.print();
    else if (action === "notifications") {
      const alerts = lowStockItems();
      const reservationRows = state.reservations.filter((booking) => booking.status === "Confirmed").map((booking) => `<div class="alert-row"><span class="notification-icon reservation-notification">▣</span><span class="alert-name"><strong>${esc(booking.name)} · ${booking.guests} guests</strong><small>${esc(booking.time)} · ${esc(booking.table || "Table to assign")}</small></span><span class="status-badge confirmed">Confirmed</span></div>`).join("");
      const eventRows = (state.notifications || []).map((notification) => `<div class="alert-row"><span class="notification-icon ${notification.type === "reservation" ? "reservation-notification" : ""}">${notification.type === "reservation" ? "▣" : "▤"}</span><span class="alert-name"><strong>${esc(notification.title)}</strong><small>${esc(notification.detail)} · ${esc(notification.createdAt)}</small></span></div>`).join("");
      state.notifications = (state.notifications || []).map((notification) => ({ ...notification, read: true }));
      state.seenReservationIds = [...new Set([...(state.seenReservationIds || []), ...state.reservations.filter((booking) => booking.status === "Confirmed").map((booking) => booking.id)])];
      saveState(); renderHeader();
      openModal("Notifications", `<div class="notification-list"><h3 class="notification-section-title">Reservations</h3>${reservationRows || `<div class="empty-state compact">No upcoming confirmed reservations.</div>`}<h3 class="notification-section-title">Recent activity</h3>${eventRows || `<div class="empty-state compact">No recent activity.</div>`}${alerts.length ? `<h3 class="notification-section-title">Inventory alerts</h3>${alerts.map((item) => `<div class="alert-row"><span class="ingredient-icon">!</span><span class="alert-name"><strong>${esc(item.name)} is running low</strong><small>${item.stock} ${esc(item.unit)} left · reorder at ${item.reorderAt} ${esc(item.unit)}</small></span></div>`).join("")}` : ""}</div><div class="modal-footer"><button class="button button-outline" data-action="close-modal">Close</button><button class="button button-primary" data-view="reservations">View reservations</button></div>`, "modal-wide");
    } else if (action === "profile") {
      openModal("Your workspace", `<div class="profile-modal"><span class="profile-avatar large">AM</span><h3>Alex Morgan</h3><p>Restaurant manager · Juniper Table</p><div class="profile-modal-actions"><button class="button button-outline" data-action="export">Export data backup</button><button class="button button-danger" data-action="reset-demo">Reset to demo data</button></div></div>`);
    } else if (action === "reset-demo") {
      if (window.confirm("Reset this browser to the original Juniper Table demo data? This removes your local changes.")) {
        state = clone(seed); ensureEmployeeData(); saveState(); closeModal(); render(); showToast("Demo data restored.");
      }
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "menu-search") {
      menuSearch = event.target.value;
      const position = event.target.selectionStart;
      render();
      const input = document.getElementById("menu-search");
      input.focus(); input.setSelectionRange(position, position);
    } else if (event.target.id === "inventory-search") {
      inventorySearch = event.target.value;
      const position = event.target.selectionStart;
      render();
      const input = document.getElementById("inventory-search");
      input.focus(); input.setSelectionRange(position, position);
    } else if (event.target.id === "reservation-search") {
      reservationSearch = event.target.value;
      const position = event.target.selectionStart;
      render();
      const input = document.getElementById("reservation-search");
      input.focus(); input.setSelectionRange(position, position);
    } else if (event.target.id === "employee-search") {
      employeeSearch = event.target.value;
      const position = event.target.selectionStart;
      render();
      const input = document.getElementById("employee-search");
      input.focus(); input.setSelectionRange(position, position);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches('[data-action="assign-chef"]')) {
      const order = state.orders.find((item) => Number(item.id) === Number(event.target.dataset.id));
      if (order) {
        order.chefId = Number(event.target.value) || null;
        saveState();
        showToast(order.chefId ? `Chef assigned to order #${order.id}.` : `Chef unassigned from order #${order.id}.`);
      }
    } else if (event.target.id === "expense-category-filter") {
      expenseCategory = event.target.value;
      render();
    } else if (event.target.id === "complaint-status-filter") {
      complaintStatusFilter = event.target.value;
      render();
    } else if (event.target.id === "complaint-severity-filter") {
      complaintSeverityFilter = event.target.value;
      render();
    } else if (event.target.id === "leave-status-filter") {
      leaveStatusFilter = event.target.value;
      render();
    } else if (event.target.id === "cover-status-filter") {
      coverStatusFilter = event.target.value;
      render();
    } else if (event.target.id === "menu-image-file" && event.target.files?.[0]) {
      const file = event.target.files[0];
      const preview = document.getElementById("menu-image-preview");
      const reader = new FileReader();
      reader.onerror = () => showToast("The selected image could not be previewed.");
      reader.onload = () => {
        preview.innerHTML = `<img src="${String(reader.result)}" alt="Selected menu photo">`;
        preview.classList.add("has-image");
      };
      reader.readAsDataURL(file);
    } else if (event.target.id === "timesheet-date") {
      const [year, month, day] = event.target.value.split("-").map(Number);
      if (year && month && day) {
        timesheetDate = new Date(year, month - 1, day);
        render();
      }
    }
  });

  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (form.id === "new-order-form") createOrder(form);
    else if (form.id === "menu-form") {
      const id = Number(form.dataset.id);
      const existing = state.menu.find((item) => item.id === id);
      let image = data.has("removeImage") ? "" : safeImage(existing?.image);
      const selectedFile = data.get("imageFile");
      if (selectedFile instanceof File && selectedFile.size) {
        try {
          image = await compressImage(selectedFile);
        } catch (error) {
          console.error("Could not save menu image.", error);
          showToast(error.message || "The selected image could not be processed.");
          return;
        }
      }
      const item = { id: existing?.id || Math.max(0, ...state.menu.map((entry) => Number(entry.id))) + 1, name: String(data.get("name")).trim(), category: String(data.get("category")), description: String(data.get("description")).trim(), price: Number(data.get("price")), popular: data.has("popular"), image, recipe: existing?.recipe || [] };
      if (existing) Object.assign(existing, item); else state.menu.push(item);
      saveState(); closeModal(); render(); showToast(existing ? "Menu item updated." : "Menu item added.");
    } else if (form.id === "ingredient-form") {
      state.inventory.push({ id: Math.max(0, ...state.inventory.map((item) => Number(item.id))) + 1, name: String(data.get("name")).trim(), category: String(data.get("category")), unit: String(data.get("unit")).trim(), stock: Number(data.get("stock")), reorderAt: Number(data.get("reorderAt")), cost: Number(data.get("cost")), supplier: String(data.get("supplier")).trim() });
      saveState(); closeModal(); render(); showToast("Ingredient added to inventory.");
    } else if (form.id === "stock-form") {
      const item = state.inventory.find((entry) => Number(entry.id) === Number(form.dataset.id));
      const quantity = Number(data.get("quantity"));
      if (!item) return;
      if (data.get("kind") === "remove" && quantity > item.stock) {
        showToast(`Only ${item.stock} ${item.unit} are available.`);
        return;
      }
      item.stock = Number((item.stock + (data.get("kind") === "add" ? quantity : -quantity)).toFixed(3));
      saveState(); closeModal(); render(); showToast(`${item.name} stock updated.`);
    } else if (form.id === "team-form") {
      const id = Number(form.dataset.id);
      const existing = state.team.find((person) => person.id === id);
      const name = String(data.get("name")).trim();
      const shiftStart = String(data.get("shiftStart"));
      const shiftEnd = String(data.get("shiftEnd"));
      const previousStatus = existing?.status;
      const person = {
        id: existing?.id || Math.max(0, ...state.team.map((entry) => Number(entry.id))) + 1,
        name,
        role: String(data.get("role")).trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        shift: `${formatShiftTime(shiftStart)} – ${formatShiftTime(shiftEnd)}`,
        shiftStart,
        shiftEnd,
        breakMinutes: Number(data.get("breakMinutes")),
        station: String(data.get("station")).trim(),
        hourlyRate: Number(data.get("hourlyRate")),
        employmentType: String(data.get("employmentType")),
        status: String(data.get("status")),
        initials: initials(name),
        color: existing?.color || ["coral", "blue", "purple", "green", "gold"][state.team.length % 5]
      };
      if (existing) Object.assign(existing, person); else state.team.push(person);
      if (person.status === "On shift" && (!existing || previousStatus !== "On shift")) {
        person.clockedInAt = new Date().toISOString();
        state.timeEntries.push({ id: `time-${person.id}-${Date.now()}`, employeeId: person.id, date: localDateKey(new Date()), clockIn: person.clockedInAt, clockOut: null, breakMinutes: 0 });
      } else if (person.status !== "On shift" && previousStatus === "On shift") {
        const openEntry = state.timeEntries.find((entry) => Number(entry.employeeId) === Number(person.id) && entry.date === localDateKey(new Date()) && !entry.clockOut);
        if (openEntry) openEntry.clockOut = new Date().toISOString();
      }
      saveState(); closeModal(); render(); showToast(existing ? "Team member updated." : "Team member added.");
    } else if (form.id === "time-entry-form") {
      const id = String(form.dataset.id || "");
      const employeeId = Number(data.get("employeeId"));
      const date = String(data.get("date"));
      const clockIn = dateAtTime(date, String(data.get("clockIn")));
      const clockOutValue = String(data.get("clockOut") || "");
      let clockOut = clockOutValue ? dateAtTime(date, clockOutValue) : null;
      if (clockOut && clockOut <= clockIn) clockOut.setDate(clockOut.getDate() + 1);
      if (clockOut && (clockOut.getTime() - clockIn.getTime()) / 60000 > 18 * 60) {
        showToast("A time entry cannot be longer than 18 hours. Check the date and times.");
        return;
      }
      if (clockIn > new Date()) {
        showToast("Clock-in time cannot be in the future.");
        return;
      }
      let entry = state.timeEntries.find((item) => String(item.id) === id);
      if (!entry) {
        entry = { id: `time-${employeeId}-${Date.now()}` };
        state.timeEntries.push(entry);
      }
      Object.assign(entry, { employeeId, date, clockIn: clockIn.toISOString(), clockOut: clockOut?.toISOString() || null, breakMinutes: Number(data.get("breakMinutes")) });
      const person = state.team.find((item) => Number(item.id) === employeeId);
      if (person && date === localDateKey(new Date())) {
        person.status = clockOut ? "Completed" : "On shift";
        person.clockedInAt = entry.clockIn;
        if (clockOut) person.clockedOutAt = entry.clockOut;
        else delete person.clockedOutAt;
      }
      timesheetDate = dateAtTime(date, "12:00");
      saveState(); closeModal(); render(); showToast("Timesheet entry saved.");
    } else if (form.id === "leave-form") {
      const startDate = String(data.get("startDate"));
      const endDate = String(data.get("endDate"));
      if (endDate < startDate) {
        showToast("The leave end date must be on or after the start date.");
        return;
      }
      const person = state.team.find((item) => Number(item.id) === Number(data.get("employeeId")));
      const request = { id: Date.now(), employeeId: Number(data.get("employeeId")), type: String(data.get("type")), startDate, endDate, note: String(data.get("note")).trim(), submittedAt: timeNow(), status: "Pending" };
      state.leaveRequests.unshift(request);
      addNotification("leave", "New leave request", `${person?.name || "An employee"} · ${request.type} · ${formatDateLabel(startDate)}`);
      saveState(); closeModal(); render(); showToast("Leave request submitted for review.");
    } else if (form.id === "cover-form") {
      const employeeId = Number(data.get("employeeId"));
      const replacementId = Number(data.get("replacementId")) || null;
      if (replacementId && employeeId === replacementId) {
        showToast("Choose a different employee as the replacement.");
        return;
      }
      const person = state.team.find((item) => Number(item.id) === employeeId);
      const request = { id: Date.now(), employeeId, replacementId, date: String(data.get("date")), shift: person?.shift || "Scheduled shift", reason: String(data.get("reason")), status: "Pending", submittedAt: timeNow() };
      state.replacementRequests.unshift(request);
      addNotification("coverage", "New shift cover request", `${person?.name || "An employee"} · ${formatDateLabel(request.date)}`);
      saveState(); closeModal(); render(); showToast("Shift cover request submitted.");
    } else if (form.id === "expense-form") {
      state.expenses.unshift({
        id: Math.max(0, ...state.expenses.map((item) => Number(item.id))) + 1,
        vendor: String(data.get("vendor")).trim(),
        category: String(data.get("category")),
        description: String(data.get("description")).trim(),
        amount: Number(data.get("amount")),
        date: String(data.get("date")),
        paymentMethod: String(data.get("paymentMethod")),
        status: String(data.get("status"))
      });
      saveState(); closeModal(); render(); showToast("Expense recorded in the demo ledger.");
    } else if (form.id === "complaint-form") {
      state.complaints.unshift({
        id: Math.max(0, ...state.complaints.map((item) => Number(item.id))) + 1,
        employeeId: Number(data.get("employeeId")),
        category: String(data.get("category")),
        subject: String(data.get("subject")).trim(),
        severity: String(data.get("severity")),
        details: String(data.get("details")).trim(),
        date: localDateKey(new Date()),
        submittedAt: timeNow(),
        status: "Open"
      });
      saveState(); closeModal(); render(); showToast("Employee complaint recorded confidentially.");
    } else if (form.id === "reservation-form") {
      const reservation = { id: Math.max(0, ...state.reservations.map((item) => Number(item.id))) + 1, name: String(data.get("name")).trim(), phone: String(data.get("phone")).trim(), time: String(data.get("time")).trim(), guests: Number(data.get("guests")), table: String(data.get("table")), status: "Confirmed" };
      state.reservations.push(reservation);
      addNotification("reservation", "New table reservation", `${reservation.name} · ${reservation.guests} guests at ${reservation.time}`);
      saveState(); closeModal(); render(); showToast(`Reservation added for ${reservation.name}.`);
    }
  });

  loadState();
  ensureEmployeeData();
  baselineCompletedSales = seed.orders.filter((order) => order.status === "Completed").reduce((sum, order) => sum + Number(order.total), 0);
  render();
  updateLiveClock();
  window.setInterval(updateLiveClock, 1000);
})();
