const mockDate = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const restaurantData = {
  restaurant: { name: "ERP Business System", location: "Downtown", currency: "USD" },
  menu: [
    { id: 1, name: "Wild mushroom risotto", category: "Mains", description: "Arborio rice, wild mushrooms, parmesan", price: 24, popular: true, image: "assets/food/wild-mushroom-risotto.jpg", recipe: [{ ingredientId: 1, quantity: 0.18 }, { ingredientId: 2, quantity: 0.12 }, { ingredientId: 3, quantity: 0.04 }] },
    { id: 2, name: "Crispy chicken sandwich", category: "Mains", description: "Buttermilk chicken, slaw, brioche bun", price: 19, popular: true, image: "https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=800&q=82", recipe: [{ ingredientId: 4, quantity: 0.2 }, { ingredientId: 5, quantity: 1 }] },
    { id: 3, name: "Heritage tomato salad", category: "Starters", description: "Heirloom tomatoes, basil, whipped feta", price: 16, popular: false, image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=82", recipe: [{ ingredientId: 6, quantity: 0.22 }, { ingredientId: 7, quantity: 0.02 }] },
    { id: 4, name: "Seared salmon", category: "Mains", description: "Atlantic salmon, spring greens, lemon butter", price: 29, popular: true, image: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=82", recipe: [{ ingredientId: 8, quantity: 0.18 }, { ingredientId: 9, quantity: 0.04 }] },
    { id: 5, name: "Truffle fries", category: "Sides", description: "Hand-cut fries, truffle oil, herbs", price: 10, popular: false, image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=800&q=82", recipe: [{ ingredientId: 10, quantity: 0.25 }] },
    { id: 6, name: "Basque cheesecake", category: "Desserts", description: "Burnt cheesecake, seasonal berries", price: 12, popular: false, image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=800&q=82", recipe: [{ ingredientId: 11, quantity: 0.14 }] },
    { id: 7, name: "House lemonade", category: "Drinks", description: "Fresh lemon, mint, sparkling water", price: 7, popular: false, image: "https://images.unsplash.com/photo-1513558161293-cdaf765edfd7?auto=format&fit=crop&w=800&q=82", recipe: [{ ingredientId: 12, quantity: 0.08 }] },
    { id: 8, name: "Espresso martini", category: "Drinks", description: "Vodka, coffee liqueur, house espresso", price: 15, popular: false, image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=800&q=82", recipe: [] }
  ],
  inventory: [
    { id: 1, name: "Arborio rice", category: "Dry goods", unit: "kg", stock: 8.4, reorderAt: 5, cost: 6.2, supplier: "Market Pantry" },
    { id: 2, name: "Wild mushrooms", category: "Produce", unit: "kg", stock: 2.1, reorderAt: 3, cost: 18, supplier: "Green Valley Farms" },
    { id: 3, name: "Parmesan", category: "Dairy", unit: "kg", stock: 3.6, reorderAt: 2, cost: 22, supplier: "Market Pantry" },
    { id: 4, name: "Chicken breast", category: "Meat & seafood", unit: "kg", stock: 4.2, reorderAt: 5, cost: 12, supplier: "Northstar Provisions" },
    { id: 5, name: "Brioche buns", category: "Bakery", unit: "each", stock: 18, reorderAt: 12, cost: 1.1, supplier: "Daily Crumb Bakery" },
    { id: 6, name: "Heirloom tomatoes", category: "Produce", unit: "kg", stock: 1.4, reorderAt: 2, cost: 9.5, supplier: "Green Valley Farms" },
    { id: 7, name: "Fresh basil", category: "Produce", unit: "kg", stock: 0.35, reorderAt: 0.5, cost: 16, supplier: "Green Valley Farms" },
    { id: 8, name: "Atlantic salmon", category: "Meat & seafood", unit: "kg", stock: 6.8, reorderAt: 4, cost: 24, supplier: "Northstar Provisions" },
    { id: 9, name: "Unsalted butter", category: "Dairy", unit: "kg", stock: 2.8, reorderAt: 2, cost: 8, supplier: "Market Pantry" },
    { id: 10, name: "Russet potatoes", category: "Produce", unit: "kg", stock: 12, reorderAt: 6, cost: 2.8, supplier: "Green Valley Farms" },
    { id: 11, name: "Cream cheese", category: "Dairy", unit: "kg", stock: 2.6, reorderAt: 2, cost: 11, supplier: "Market Pantry" },
    { id: 12, name: "Fresh lemons", category: "Produce", unit: "kg", stock: 3.2, reorderAt: 2, cost: 4.5, supplier: "Green Valley Farms" }
  ],
  team: [
    { id: 1, name: "Mia Chen", role: "Head chef", initials: "MC", shift: "3:00 PM – 11:00 PM", shiftStart: "15:00", shiftEnd: "23:00", breakMinutes: 30, station: "Hot line", status: "On shift", color: "coral", hourlyRate: 27 },
    { id: 2, name: "Jordan Lee", role: "Sous chef", initials: "JL", shift: "3:00 PM – 11:00 PM", shiftStart: "15:00", shiftEnd: "23:00", breakMinutes: 30, station: "Prep & pass", status: "On shift", color: "blue", hourlyRate: 23 },
    { id: 3, name: "Sofia Rivera", role: "Floor manager", initials: "SR", shift: "3:00 PM – 11:00 PM", shiftStart: "15:00", shiftEnd: "23:00", breakMinutes: 30, station: "Floor", status: "On shift", color: "purple", hourlyRate: 24 },
    { id: 4, name: "Noah Williams", role: "Waiter", initials: "NW", shift: "4:00 PM – 10:00 PM", shiftStart: "16:00", shiftEnd: "22:00", breakMinutes: 20, station: "Sections 1–3", status: "On shift", color: "green", phone: "(555) 010-4812", email: "noah@junipertable.example", hourlyRate: 16.5, employmentType: "Full time" },
    { id: 5, name: "Ava Patel", role: "Waiter", initials: "AP", shift: "4:00 PM – 11:00 PM", shiftStart: "16:00", shiftEnd: "23:00", breakMinutes: 20, station: "Sections 4–6", status: "Upcoming", color: "gold", phone: "(555) 010-2218", email: "ava@junipertable.example", hourlyRate: 15.5, employmentType: "Part time" },
    { id: 6, name: "Ethan Brooks", role: "Bartender", initials: "EB", shift: "4:00 PM – 12:00 AM", shiftStart: "16:00", shiftEnd: "00:00", breakMinutes: 20, station: "Bar", status: "Upcoming", color: "blue", phone: "(555) 010-0825", email: "ethan@junipertable.example", hourlyRate: 17.5, employmentType: "Full time" },
    { id: 7, name: "Layla Hassan", role: "Waiter", initials: "LH", shift: "5:00 PM – 11:00 PM", shiftStart: "17:00", shiftEnd: "23:00", breakMinutes: 20, station: "Sections 7–9", status: "Upcoming", color: "purple", phone: "(555) 010-6674", email: "layla@junipertable.example", hourlyRate: 15.5, employmentType: "Part time" },
    { id: 8, name: "Mateo Garcia", role: "Waiter", initials: "MG", shift: "5:00 PM – 11:00 PM", shiftStart: "17:00", shiftEnd: "23:00", breakMinutes: 20, station: "Patio", status: "Upcoming", color: "coral", phone: "(555) 010-9302", email: "mateo@junipertable.example", hourlyRate: 16, employmentType: "Part time" }
  ],
  reservations: [
    { id: 1, name: "Olivia Parker", guests: 2, time: "5:30 PM", table: "Table 04", status: "Confirmed", phone: "(555) 018-4021" },
    { id: 2, name: "Theodore James", guests: 4, time: "6:00 PM", table: "Table 08", status: "Seated", phone: "(555) 013-7782" },
    { id: 3, name: "Isabella Moore", guests: 6, time: "6:30 PM", table: "Table 12", status: "Confirmed", phone: "(555) 017-2936" },
    { id: 4, name: "Lucas Anderson", guests: 2, time: "7:00 PM", table: "Table 03", status: "Confirmed", phone: "(555) 012-1148" },
    { id: 5, name: "Amelia Taylor", guests: 3, time: "7:30 PM", table: "Table 06", status: "Confirmed", phone: "(555) 016-9004" }
  ],
  orders: [
    { id: 1048, type: "Dine in", table: "Table 04", customer: "Olivia P.", items: [{ menuId: 1, quantity: 1 }, { menuId: 7, quantity: 2 }], total: 38, status: "Preparing", payment: "Unpaid", createdAt: "5:18 PM", date: mockDate(0), chefId: 1, stockApplied: false },
    { id: 1047, type: "Dine in", table: "Table 08", customer: "Theodore J.", items: [{ menuId: 4, quantity: 2 }, { menuId: 5, quantity: 1 }], total: 68, status: "Ready", payment: "Unpaid", createdAt: "5:12 PM", date: mockDate(0), chefId: 2, stockApplied: false },
    { id: 1046, type: "Takeaway", table: "—", customer: "Nina Foster", items: [{ menuId: 2, quantity: 1 }, { menuId: 5, quantity: 1 }], total: 29, status: "Preparing", payment: "Paid", createdAt: "5:06 PM", date: mockDate(0), chefId: 2, stockApplied: false },
    { id: 1045, type: "Delivery", table: "—", customer: "Daniel Kim", items: [{ menuId: 3, quantity: 1 }, { menuId: 6, quantity: 2 }], total: 40, status: "Completed", payment: "Paid", createdAt: "4:52 PM", date: mockDate(0), stockApplied: false },
    { id: 1044, type: "Dine in", table: "Table 02", customer: "Emily R.", items: [{ menuId: 2, quantity: 2 }, { menuId: 7, quantity: 1 }], total: 45, status: "Completed", payment: "Paid", createdAt: "4:41 PM", date: mockDate(0), stockApplied: false }
  ],
  leaveRequests: [
    { id: 201, employeeId: 5, type: "Paid time off", startDate: mockDate(5), endDate: mockDate(7), note: "Family trip booked earlier this year.", submittedAt: "10:14 AM", status: "Pending" },
    { id: 202, employeeId: 1, type: "Personal day", startDate: mockDate(12), endDate: mockDate(12), note: "Personal appointment.", submittedAt: "Yesterday", status: "Pending" },
    { id: 203, employeeId: 7, type: "Paid time off", startDate: mockDate(-12), endDate: mockDate(-10), note: "Approved annual leave.", submittedAt: "Oct 18", status: "Approved" }
  ],
  replacementRequests: [
    { id: 301, employeeId: 5, replacementId: 7, date: mockDate(2), shift: "4:00 PM – 11:00 PM", reason: "Schedule conflict", submittedAt: "11:32 AM", status: "Pending" },
    { id: 302, employeeId: 6, replacementId: null, date: mockDate(3), shift: "4:00 PM – 12:00 AM", reason: "Personal commitment", submittedAt: "Yesterday", status: "Pending" },
    { id: 303, employeeId: 4, replacementId: 8, date: mockDate(-2), shift: "4:00 PM – 10:00 PM", reason: "Schedule conflict", submittedAt: "Oct 20", status: "Approved" }
  ],
  expenses: [
    { id: 401, date: mockDate(0), vendor: "Green Valley Farms", category: "Food & beverage", description: "Produce delivery", amount: 286.4, status: "Paid", paymentMethod: "Business card" },
    { id: 402, date: mockDate(0), vendor: "Northstar Provisions", category: "Food & beverage", description: "Seafood and poultry", amount: 418.75, status: "Pending", paymentMethod: "Bank transfer" },
    { id: 403, date: mockDate(-1), vendor: "City Utilities", category: "Utilities", description: "Electricity and water", amount: 192.6, status: "Paid", paymentMethod: "Direct debit" },
    { id: 404, date: mockDate(-2), vendor: "Daily Crumb Bakery", category: "Food & beverage", description: "Bread and pastry order", amount: 164.2, status: "Paid", paymentMethod: "Business card" },
    { id: 405, date: mockDate(-4), vendor: "CleanSpace Services", category: "Cleaning", description: "Weekly kitchen deep clean", amount: 135, status: "Pending", paymentMethod: "Bank transfer" },
    { id: 406, date: mockDate(-6), vendor: "Metro Gas", category: "Utilities", description: "Kitchen gas", amount: 248.5, status: "Paid", paymentMethod: "Direct debit" }
  ],
  complaints: [
    { id: 501, date: mockDate(0), employeeId: 4, category: "Scheduling", severity: "Medium", subject: "Late schedule change", details: "My section was changed after the weekly rota was published. Could changes be shared at least a day ahead?", status: "Open", submittedAt: "11:42 AM" },
    { id: 502, date: mockDate(-1), employeeId: 2, category: "Equipment", severity: "High", subject: "Prep station fridge runs warm", details: "The under-counter refrigerator near prep has been above its usual temperature since yesterday.", status: "In review", submittedAt: "Yesterday" },
    { id: 503, date: mockDate(-2), employeeId: 7, category: "Workplace", severity: "Low", subject: "Request for locker space", details: "A few new team members need assigned lockers in the staff area.", status: "Resolved", submittedAt: "Oct 22" }
  ],
  wagePayments: [
    { id: 601, employeeId: 1, period: "Previous week", amount: 864, status: "Paid", paidDate: mockDate(-3), method: "Payroll transfer" },
    { id: 602, employeeId: 2, period: "Previous week", amount: 736, status: "Paid", paidDate: mockDate(-3), method: "Payroll transfer" },
    { id: 603, employeeId: 4, period: "Previous week", amount: 495, status: "Paid", paidDate: mockDate(-3), method: "Payroll transfer" }
  ],
  sales: [1820, 2140, 1760, 2480, 2260, 2910, 2640],
  salesLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
};

export default restaurantData;
