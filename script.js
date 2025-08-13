// Date-fns functions for easy date manipulation
import { format, parseISO, addMonths, subMonths, differenceInCalendarMonths, startOfMonth } from "https://cdn.skypack.dev/date-fns";
import { v4 as uuidv4 } from "https://jspm.dev/uuid";

// --- GLOBAL VARIABLES AND STATE ---
let budgets = {};
let debtList = [];
let goals = [];
let categories = {}; // NEW: Persistent categories storage
let currentMonth = format(new Date(), 'yyyy-MM');
let readyToAssign = 0;
let debtViewMethod = 'snowball';
let selectedDebtId = null;
let editingHistoricalTransactionId = null;

// --- LOCAL FILE STORAGE FUNCTIONALITY ---
let fileHandle;

// Use a more modern promise-based wrapper for IndexedDB
async function getDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('budget-app-db', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
            }
        };
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function saveFileHandle(handle) {
    try {
        const db = await getDb();
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        await store.put(handle, 'budgetFile');
        console.log('File handle saved to IndexedDB.');
    } catch (error) {
        console.error('Error saving file handle:', error);
        showErrorModal('Could not save file reference. Your browser may be in private mode.');
    }
}

async function getFileHandleFromDB() {
    try {
        const db = await getDb();
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const handle = await new Promise((resolve, reject) => {
            const request = store.get('budgetFile');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return handle;
    } catch (error) {
        console.error('Error getting file handle from DB:', error);
        return null;
    }
}

async function chooseNewDataFile() {
    try {
        fileHandle = await window.showSaveFilePicker({
            suggestedName: 'budgetData.json',
            types: [{
                description: 'JSON Files',
                accept: {
                    'application/json': ['.json']
                }
            }],
        });
        await saveFileHandle(fileHandle);
        // Write initial empty data structure with persistent categories
        const initialData = { 
            monthlyBudgets: {}, 
            debtList: [], 
            goals: [], 
            categories: {}, // NEW: Persistent categories
            readyToAssign: 0 
        };
        await writeFile(initialData);
        return initialData;
    } catch (error) {
        showErrorModal("File selection was cancelled or an error occurred. The app will run without a persistent data file until you select one.");
        console.error("File selection error:", error);
        return { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
    }
}

async function readFile() {
    if (!fileHandle) {
        return { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
    }
    try {
        const file = await fileHandle.getFile();
        const contents = await file.text();
        return JSON.parse(contents || '{}');
    } catch (error) {
        showErrorModal("Error reading data file. It may be corrupted or not a valid JSON file. Please try selecting a different file.");
        console.error("Error parsing JSON:", error);
        return { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
    }
}

async function writeFile(data) {
    if (!fileHandle) {
        showErrorModal("No data file selected. Please select a file to save your changes.");
        return;
    }
    try {
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    } catch (error) {
        if (error.name === 'NotAllowedError') {
            showErrorModal("Permission to write to the file was denied. Please select a new file.");
            fileHandle = null;
        } else {
            showErrorModal("Could not save data to file. Please ensure the file is not locked or deleted.");
        }
        console.error("Error writing to file:", error);
    }
}

const saveDataToFile = async () => {
    const dataToSave = {
        monthlyBudgets: budgets,
        debtList: debtList,
        goals: goals,
        categories: categories, // NEW: Save persistent categories
        readyToAssign: readyToAssign,
    };
    await writeFile(dataToSave);
    console.log("Data saved to local file.");
};

// --- CHART.JS INSTANCES ---
let expensesByCategoryChart;
let debtProgressChart;
let budgetVsActualChart;

// --- DOM ELEMENT REFERENCES ---
const monthHeader = document.getElementById('monthHeader');
const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');
const readyToAssignAmount = document.getElementById('readyToAssignAmount');
const budgetTableBody = document.getElementById('budgetTableBody');
const debtTableBody = document.getElementById('debtTableBody');
const goalsTableBody = document.getElementById('goalsTableBody');
const historicalTableBody = document.getElementById('historicalTableBody');
const newCategoryNameInput = document.getElementById('newCategoryName');
const newParentCategoryInput = document.getElementById('newParentCategory');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const addTransactionBtn = document.getElementById('addTransactionBtn');
const addBulkTransactionBtn = document.getElementById('addBulkTransactionBtn');
const addDebtBtn = document.getElementById('addDebtBtn');
const addGoalBtn = document.getElementById('addGoalBtn');
const debtSnowballBtn = document.getElementById('debtSnowballBtn');
const debtAvalancheBtn = document.getElementById('debtAvalancheBtn');
const budgetViewBtn = document.getElementById('budgetViewBtn');
const reportsViewBtn = document.getElementById('reportsViewBtn');
const historicalDataBtn = document.getElementById('historicalDataBtn');
const exportDataBtn = document.getElementById('exportDataBtn');
const changeFileBtn = document.getElementById('changeFileBtn');
const selectFileBtn = document.getElementById('selectFileBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const appContainer = document.querySelector('.app-container');
const copyCategoriesBtn = document.getElementById('copyCategoriesBtn');

// Modals and their elements
const goalModal = document.getElementById('goalModal');
const goalNameInput = document.getElementById('goalNameInput');
const goalDescriptionInput = document.getElementById('goalDescriptionInput');
const goalDueDateInput = document.getElementById('goalDueDateInput');
const goalAmountInput = document.getElementById('goalAmountInput');
const saveGoalBtn = document.getElementById('saveGoalBtn');
const closeGoalModalBtn = document.getElementById('closeGoalModalBtn');

const assignModal = document.getElementById('assignModal');
const assignAmountInput = document.getElementById('assignAmountInput');
const assignMonthSelect = document.getElementById('assignMonthSelect');
const assignFundsBtn = document.getElementById('assignFundsBtn');
const closeAssignModalBtn = document.getElementById('closeAssignModalBtn');
const assignAvailable = document.getElementById('assignAvailable');

const transactionModal = document.getElementById('transactionModal');
const transactionAmountInput = document.getElementById('transactionAmountInput');
const transactionTypeSelect = document.getElementById('transactionTypeSelect');
const transactionDateInput = document.getElementById('transactionDateInput');
const transactionDescriptionInput = document.getElementById('transactionDescriptionInput');
const transactionCategorySelect = document.getElementById('transactionCategorySelect');
const recordTransactionBtn = document.getElementById('recordTransactionBtn');
const closeTransactionModalBtn = document.getElementById('closeTransactionModalBtn');

const editTransactionModal = document.getElementById('editTransactionModal');
const editTransactionDateInput = document.getElementById('editTransactionDateInput');
const editTransactionAmountInput = document.getElementById('editTransactionAmountInput');
const editTransactionTypeSelect = document.getElementById('editTransactionTypeSelect');
const editTransactionDescriptionInput = document.getElementById('editTransactionDescriptionInput');
const editTransactionCategorySelect = document.getElementById('editTransactionCategorySelect');
const closeEditTransactionModalBtn = document.getElementById('closeEditTransactionModalBtn');
const saveEditedTransactionBtn = document.getElementById('saveEditedTransactionBtn');

const bulkTransactionModal = document.getElementById('bulkTransactionModal');
const bulkTransactionsTextarea = document.getElementById('bulkTransactionsTextarea');
const addBulkTransactionsBtnModal = document.getElementById('addBulkTransactionsBtnModal');
const closeBulkTransactionModalBtn = document.getElementById('closeBulkTransactionModalBtn');

const debtModal = document.getElementById('debtModal');
const debtNameInput = document.getElementById('debtNameInput');
const debtOriginalBalanceInput = document.getElementById('debtOriginalBalanceInput');
const debtCurrentBalanceInput = document.getElementById('debtCurrentBalanceInput');
const debtInterestRateInput = document.getElementById('debtInterestRateInput');
const debtMinPaymentInput = document.getElementById('debtMinPaymentInput');
const addDebtConfirmBtn = document.getElementById('addDebtConfirmBtn');
const closeDebtModalBtn = document.getElementById('closeDebtModalBtn');

const paymentModal = document.getElementById('paymentModal');
const paymentDebtName = document.getElementById('paymentDebtName');
const paymentAmountInput = document.getElementById('paymentAmountInput');
const paymentAvailableFunds = document.getElementById('paymentAvailableFunds');
const recordPaymentConfirmBtn = document.getElementById('recordPaymentConfirmBtn');
const closePaymentModalBtn = document.getElementById('closePaymentModalBtn');

const duplicateConfirmationModal = document.getElementById('duplicateConfirmationModal');
const duplicateDate = document.getElementById('duplicateDate');
const duplicateAmount = document.getElementById('duplicateAmount');
const duplicateDescription = document.getElementById('duplicateDescription');
const addDuplicateAnywayBtn = document.getElementById('addDuplicateAnywayBtn');
const skipDuplicateBtn = document.getElementById('skipDuplicateBtn');

const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const closeErrorModalBtn = document.getElementById('closeErrorModalBtn');

// --- UTILITY FUNCTIONS ---
function formatCurrency(amount) {
    return `$${parseFloat(amount).toFixed(2)}`;
}

function getMonthData(month) {
    if (!budgets[month]) {
        budgets[month] = {
            categories: {},
            transactions: [],
        };
    }
    return budgets[month];
}

// NEW: Category management functions for persistent categories
function addPersistentCategory(name, parentCategory = '') {
    const categoryId = uuidv4();
    categories[categoryId] = {
        id: categoryId,
        name: name,
        parentCategory: parentCategory,
        createdDate: format(new Date(), 'yyyy-MM-dd'),
        isActive: true
    };
    return categoryId;
}

function getAllActiveCategories() {
    return Object.values(categories).filter(cat => cat.isActive);
}

function getCategoryById(id) {
    return categories[id];
}

function groupCategoriesByParent() {
    const grouped = {};
    const activeCategories = getAllActiveCategories();
    
    activeCategories.forEach(category => {
        const parent = category.parentCategory || 'No Parent';
        if (!grouped[parent]) {
            grouped[parent] = [];
        }
        grouped[parent].push(category);
    });
    
    return grouped;
}

function calculateActivity(month, categoryId) {
    const monthData = getMonthData(month);
    return monthData.transactions
        .filter(t => t.categoryId === categoryId && t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
}

function calculateCategoryAvailable(month, categoryId) {
    const monthData = getMonthData(month);
    const assigned = monthData.categories[categoryId]?.assigned || 0;
    const activity = calculateActivity(month, categoryId);
    return assigned - activity;
}

function showModal(modalElement) {
    modalElement.style.display = 'flex';
}

function hideModal(modalElement) {
    modalElement.style.display = 'none';
}

function showErrorModal(message) {
    errorMessage.textContent = message;
    showModal(errorModal);
}

// --- RENDERING FUNCTIONS ---
function renderUI() {
    monthHeader.textContent = format(parseISO(currentMonth + '-01'), 'MMMM yyyy');
    readyToAssignAmount.textContent = formatCurrency(readyToAssign);

    const monthData = getMonthData(currentMonth);
    renderBudgetTable(monthData);
    renderGoalsTable();
    renderDebtTable();
    renderHistoricalDataTable();
}

// NEW: Updated budget table rendering with persistent categories
function renderBudgetTable(monthData) {
    budgetTableBody.innerHTML = '';
    const groupedCategories = groupCategoriesByParent();
    
    // Sort parent categories
    const sortedParents = Object.keys(groupedCategories).sort();
    
    sortedParents.forEach(parentName => {
        // Add parent header row if not "No Parent"
        if (parentName !== 'No Parent') {
            const parentRow = document.createElement('tr');
            parentRow.className = 'parent-category-row';
            parentRow.innerHTML = `
                <td colspan="5" style="font-weight: bold; background-color: #f5f5f5; padding: 12px;">
                    ${parentName}
                </td>
            `;
            budgetTableBody.appendChild(parentRow);
        }
        
        // Add child categories
        groupedCategories[parentName].forEach(category => {
            const monthlyData = monthData.categories[category.id] || { assigned: 0 };
            const activity = calculateActivity(currentMonth, category.id);
            const available = calculateCategoryAvailable(currentMonth, category.id);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="padding-left: ${parentName !== 'No Parent' ? '20px' : '16px'};">${category.name}</td>
                <td>
                    <input type="number" 
                           value="${monthlyData.assigned}" 
                           onchange="updateCategoryAssigned('${category.id}', this.value)"
                           step="0.01"
                           style="width: 100px;">
                </td>
                <td>${formatCurrency(activity)}</td>
                <td style="color: ${available >= 0 ? '#10b981' : '#ef4444'};">${formatCurrency(available)}</td>
                <td>
                    <button class="btn-primary" onclick="handleAssignFunds('${category.id}')">Assign</button>
                    <button class="btn-secondary" onclick="handleQuickBudget('${category.id}')">Quick Budget</button>
                    <button class="btn-red" onclick="handleDeleteCategory('${category.id}')">Delete</button>
                </td>
            `;
            budgetTableBody.appendChild(row);
        });
    });
}

// NEW: Function to update category assigned amount
window.updateCategoryAssigned = (categoryId, value) => {
    const monthData = getMonthData(currentMonth);
    const newValue = parseFloat(value) || 0;
    const oldValue = monthData.categories[categoryId]?.assigned || 0;
    const difference = newValue - oldValue;
    
    if (difference > readyToAssign) {
        showErrorModal('You cannot assign more money than you have available.');
        renderBudgetTable(monthData); // Reset the input
        return;
    }
    
    if (!monthData.categories[categoryId]) {
        monthData.categories[categoryId] = { assigned: 0 };
    }
    
    monthData.categories[categoryId].assigned = newValue;
    readyToAssign -= difference;
    
    renderUI();
    saveDataToFile();
};

// NEW: Function to delete a category
window.handleDeleteCategory = (categoryId) => {
    const category = getCategoryById(categoryId);
    if (!category) return;
    
    if (confirm(`Are you sure you want to delete the category "${category.name}"? This will remove it from all months and cannot be undone.`)) {
        // Mark category as inactive instead of deleting to preserve data integrity
        categories[categoryId].isActive = false;
        
        renderUI();
        saveDataToFile();
    }
};

function renderGoalsTable() {
    goalsTableBody.innerHTML = '';
    
    goals.forEach(goal => {
        let totalAssigned = 0;
        for (const monthKey in budgets) {
            // Find category by name for goals (legacy support)
            const goalCategory = Object.values(categories).find(cat => cat.name === goal.name);
            if (goalCategory && budgets[monthKey].categories[goalCategory.id]) {
                totalAssigned += budgets[monthKey].categories[goalCategory.id].assigned || 0;
            }
        }
        const progress = goal.totalAmount > 0 ? (totalAssigned / goal.totalAmount) * 100 : 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${goal.name}<br><small style="color: #6b7280;">${goal.description || ''}</small></td>
            <td>${format(parseISO(goal.dueDate), 'MMM yyyy')}</td>
            <td>${formatCurrency(goal.totalAmount)}</td>
            <td>${formatCurrency(goal.monthlyContribution)}</td>
            <td>
                <div style="width: 100%; background-color: #e5e7eb; border-radius: 9999px;">
                    <div style="width: ${progress.toFixed(2)}%; background-color: #10b981; color: white; text-align: center; border-radius: 9999px; padding: 2px 0;">
                        ${progress.toFixed(0)}%
                    </div>
                </div>
            </td>
            <td>
                <button class="btn-red" onclick="handleDeleteGoal('${goal.id}')">Delete</button>
            </td>
        `;
        goalsTableBody.appendChild(row);
    });
}

function renderDebtTable() {
    debtTableBody.innerHTML = '';

    const sortedDebtList = [...debtList];

    if (debtViewMethod === 'snowball') {
        sortedDebtList.sort((a, b) => a.currentBalance - b.currentBalance);
    } else if (debtViewMethod === 'avalanche') {
        sortedDebtList.sort((a, b) => b.interestRate - a.interestRate);
    }

    sortedDebtList.forEach(debt => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${debt.name}</td>
            <td>${formatCurrency(debt.currentBalance)}</td>
            <td>${debt.interestRate}%</td>
            <td>${formatCurrency(debt.minPayment)}</td>
            <td>
                <button class="btn-primary" onclick="handleRecordPayment('${debt.id}')">Pay</button>
                <button class="btn-red" onclick="handleDeleteDebt('${debt.id}')">Delete</button>
            </td>
        `;
        debtTableBody.appendChild(row);
    });
}

function renderHistoricalDataTable() {
    historicalTableBody.innerHTML = '';
    
    let allTransactions = [];
    for (const monthKey in budgets) {
        const monthData = budgets[monthKey];
        const monthTransactions = monthData.transactions.map(t => {
            const category = getCategoryById(t.categoryId);
            return {
                ...t,
                month: monthKey,
                categoryName: category ? category.name : 'Unknown Category',
                categoryParent: category ? category.parentCategory : ''
            };
        });
        allTransactions.push(...monthTransactions);
    }
    
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    allTransactions.forEach(transaction => {
        const row = document.createElement('tr');
        const amountColor = transaction.type === 'income' ? '#10b981' : '#ef4444';
        const formattedDate = format(parseISO(transaction.date), 'MM-dd-yyyy');
        
        row.innerHTML = `
            <td>${transaction.month}</td>
            <td>${formattedDate}</td>
            <td>${transaction.categoryName}</td>
            <td>${transaction.categoryParent}</td>
            <td>${transaction.description}</td>
            <td style="color: ${amountColor};">${formatCurrency(transaction.type === 'expense' ? -transaction.amount : transaction.amount)}</td>
            <td>
                <button class="btn-primary" onclick="handleEditTransaction('${transaction.id}')">Edit</button>
                <button class="btn-red" onclick="handleDeleteTransaction('${transaction.id}', '${transaction.month}')">Delete</button>
            </td>
        `;
        historicalTableBody.appendChild(row);
    });
}

function renderCharts() {
    // Expenses by Category Chart
    if (expensesByCategoryChart) { expensesByCategoryChart.destroy(); }
    const expensesByCatCanvas = document.getElementById('expensesByCategoryChart');
    if (expensesByCatCanvas) {
        const expenses = {};
        getMonthData(currentMonth).transactions
            .filter(t => t.type === 'expense')
            .forEach(t => {
                const category = getCategoryById(t.categoryId);
                const categoryName = category ? category.name : 'Unknown';
                expenses[categoryName] = (expenses[categoryName] || 0) + t.amount;
            });

        expensesByCategoryChart = new Chart(expensesByCatCanvas, {
            type: 'doughnut',
            data: {
                labels: Object.keys(expenses),
                datasets: [{
                    data: Object.values(expenses),
                    backgroundColor: [
                        '#4f46e5', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
                        '#8b5cf6', '#ec4899', '#22c55e', '#f97316', '#a855f7'
                    ],
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: `Expenses for ${format(parseISO(currentMonth + '-01'), 'MMMM yyyy')}`
                    }
                }
            }
        });
    }

    // Debt Progress Chart
    if (debtProgressChart) { debtProgressChart.destroy(); }
    const debtProgressCanvas = document.getElementById('debtProgressChart');
    if (debtProgressCanvas) {
        const debtNames = debtList.map(d => d.name);
        const debtBalances = debtList.map(d => d.currentBalance);
        
        debtProgressChart = new Chart(debtProgressCanvas, {
            type: 'bar',
            data: {
                labels: debtNames,
                datasets: [{
                    label: 'Current Balance',
                    data: debtBalances,
                    backgroundColor: '#4f46e5',
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'Debt Balances'
                    }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
}

function showView(viewId) {
    document.querySelectorAll('.view-section').forEach(view => {
        view.style.display = 'none';
    });
    document.getElementById(viewId).style.display = 'block';

    document.querySelectorAll('.view-toggles button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`${viewId}Btn`).classList.add('active');
    
    if (viewId === 'reportsView') {
        renderCharts();
    }
}

// --- EVENT HANDLERS ---

// NEW: Event handlers for Goals
addGoalBtn.addEventListener('click', () => {
    goalNameInput.value = '';
    goalDescriptionInput.value = '';
    goalDueDateInput.value = '';
    goalAmountInput.value = '';
    showModal(goalModal);
});

saveGoalBtn.addEventListener('click', () => {
    const name = goalNameInput.value.trim();
    const description = goalDescriptionInput.value.trim();
    const dueDate = goalDueDateInput.value;
    const totalAmount = parseFloat(goalAmountInput.value);

    if (!name || !dueDate || isNaN(totalAmount) || totalAmount <= 0) {
        showErrorModal("Please provide a valid goal name, due date, and total amount.");
        return;
    }

    const startDate = startOfMonth(new Date());
    const endDate = parseISO(dueDate);

    if (endDate <= startDate) {
        showErrorModal("The due date must be in the future.");
        return;
    }

    const monthsBetween = differenceInCalendarMonths(endDate, startDate) + 1;
    const monthlyContribution = totalAmount / monthsBetween;

    const newGoal = {
        id: uuidv4(),
        name,
        description,
        dueDate,
        totalAmount,
        monthlyContribution
    };

    goals.push(newGoal);

    // Create persistent category for the goal
    const categoryId = addPersistentCategory(name, 'Financial Goals');

    // Automatically assign budget for the goal across months
    for (let i = 0; i < monthsBetween; i++) {
        const monthKey = format(addMonths(startDate, i), 'yyyy-MM');
        const monthData = getMonthData(monthKey);
        
        if (!monthData.categories[categoryId]) {
            monthData.categories[categoryId] = { assigned: 0 };
        }
        monthData.categories[categoryId].assigned = monthlyContribution;
    }
    
    hideModal(goalModal);
    renderUI();
    saveDataToFile();
});

window.handleDeleteGoal = (goalId) => {
    if (confirm("Are you sure you want to delete this goal? This will not delete the associated category or any assigned funds.")) {
        goals = goals.filter(g => g.id !== goalId);
        renderUI();
        saveDataToFile();
    }
};

// NEW: Updated assign funds handler
window.handleAssignFunds = (categoryId) => {
    const category = getCategoryById(categoryId);
    if (!category) return;
    
    assignAvailable.textContent = formatCurrency(readyToAssign);
    
    assignMonthSelect.innerHTML = '';
    for (const monthKey in budgets) {
        const option = document.createElement('option');
        option.value = monthKey;
        option.textContent = format(parseISO(monthKey + '-01'), 'MMMM yyyy');
        assignMonthSelect.appendChild(option);
    }
    assignMonthSelect.value = currentMonth;
    
    showModal(assignModal);
    
    assignFundsBtn.onclick = () => {
        const amount = parseFloat(assignAmountInput.value);
        const assignToMonth = assignMonthSelect.value;
        if (isNaN(amount) || amount <= 0) {
            showErrorModal('Please enter a valid amount to assign.');
            return;
        }
        if (amount > readyToAssign) {
            showErrorModal('You cannot assign more money than you have available.');
            return;
        }
        if (!assignToMonth) {
            showErrorModal('Please select a month to assign funds to.');
            return;
        }
        
        const monthData = getMonthData(assignToMonth);
        if (!monthData.categories[categoryId]) {
            monthData.categories[categoryId] = { assigned: 0 };
        }
        monthData.categories[categoryId].assigned += amount;
        readyToAssign -= amount;
        
        hideModal(assignModal);
        renderUI();
        saveDataToFile();
    };
};

// NEW: Updated add category handler
addCategoryBtn.addEventListener('click', () => {
    const newCategoryName = newCategoryNameInput.value.trim();
    const newParentCategory = newParentCategoryInput.value.trim();
    
    if (newCategoryName === '') {
        showErrorModal('Category name cannot be empty.');
        return;
    }

    // Check if category name already exists
    const existingCategory = Object.values(categories).find(cat => 
        cat.name.toLowerCase() === newCategoryName.toLowerCase() && cat.isActive
    );
    
    if (existingCategory) {
        showErrorModal('A category with this name already exists.');
        return;
    }

    // Add persistent category
    const categoryId = addPersistentCategory(newCategoryName, newParentCategory);
    
    // Initialize in current month with zero assignment
    const currentMonthData = getMonthData(currentMonth);
    currentMonthData.categories[categoryId] = { assigned: 0 };
    
    newCategoryNameInput.value = '';
    newParentCategoryInput.value = '';
    renderUI();
    saveDataToFile();
});

// NEW: Updated transaction handlers to use category IDs
addTransactionBtn.addEventListener('click', () => {
    transactionAmountInput.value = '';
    transactionDescriptionInput.value = '';
    transactionTypeSelect.value = 'expense';
    transactionDateInput.value = format(new Date(), 'yyyy-MM-dd');
    
    // Populate category dropdown with active categories
    transactionCategorySelect.innerHTML = '<option value="">Select a Category</option>';
    const activeCategories = getAllActiveCategories().sort((a, b) => a.name.localeCompare(b.name));
    
    activeCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        transactionCategorySelect.appendChild(option);
    });

    showModal(transactionModal);
});

function isDuplicateTransaction(transaction) {
    const monthData = getMonthData(currentMonth);
    return monthData.transactions.some(t =>
        t.date === transaction.date &&
        t.amount === transaction.amount &&
        t.description === transaction.description
    );
}

recordTransactionBtn.addEventListener('click', () => {
    const amount = parseFloat(transactionAmountInput.value);
    const type = transactionTypeSelect.value;
    const date = transactionDateInput.value;
    const description = transactionDescriptionInput.value;
    const categoryId = transactionCategorySelect.value;
    
    if (isNaN(amount) || amount <= 0 || !date || !description) {
        showErrorModal('Please fill out all fields with valid data.');
        return;
    }
    if (type === 'expense' && !categoryId) {
        showErrorModal('Please select a category for expenses.');
        return;
    }

    const month = format(parseISO(date), 'yyyy-MM');
    const monthData = getMonthData(month);

    const newTransaction = {
        id: uuidv4(),
        date,
        amount,
        description,
        type,
        categoryId: categoryId || null
    };

    if (isDuplicateTransaction(newTransaction)) {
        duplicateDate.textContent = newTransaction.date;
        duplicateAmount.textContent = formatCurrency(newTransaction.amount);
        duplicateDescription.textContent = newTransaction.description;
        showModal(duplicateConfirmationModal);
        
        addDuplicateAnywayBtn.onclick = () => {
            monthData.transactions.push(newTransaction);
            updateReadyToAssign(newTransaction);
            hideModal(duplicateConfirmationModal);
            hideModal(transactionModal);
            renderUI();
            saveDataToFile();
        };
        skipDuplicateBtn.onclick = () => {
            hideModal(duplicateConfirmationModal);
        };
    } else {
        monthData.transactions.push(newTransaction);
        updateReadyToAssign(newTransaction);
        hideModal(transactionModal);
        renderUI();
        saveDataToFile();
    }
});

function updateReadyToAssign(transaction) {
    if (transaction.type === 'income') {
        readyToAssign += transaction.amount;
    }
}

// NEW: Updated edit transaction handler
window.handleEditTransaction = (transactionId) => {
    editingHistoricalTransactionId = transactionId;
    let transactionToEdit;
    let transactionMonth;
    
    for (const monthKey in budgets) {
        const monthData = budgets[monthKey];
        const foundTransaction = monthData.transactions.find(t => t.id === transactionId);
        if (foundTransaction) {
            transactionToEdit = foundTransaction;
            transactionMonth = monthKey;
            break;
        }
    }
    
    if (!transactionToEdit) {
        showErrorModal('Transaction not found.');
        return;
    }
    
    editTransactionDateInput.value = transactionToEdit.date;
    editTransactionAmountInput.value = transactionToEdit.amount;
    editTransactionTypeSelect.value = transactionToEdit.type;
    editTransactionDescriptionInput.value = transactionToEdit.description;

    // Populate category dropdown
    editTransactionCategorySelect.innerHTML = '<option value="">Select a Category</option>';
    const activeCategories = getAllActiveCategories().sort((a, b) => a.name.localeCompare(b.name));
    
    activeCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        editTransactionCategorySelect.appendChild(option);
    });
    editTransactionCategorySelect.value = transactionToEdit.categoryId || '';

    showModal(editTransactionModal);
};

saveEditedTransactionBtn.addEventListener('click', () => {
    const newDate = editTransactionDateInput.value;
    const newAmount = parseFloat(editTransactionAmountInput.value);
    const newType = editTransactionTypeSelect.value;
    const newDescription = editTransactionDescriptionInput.value;
    const newCategoryId = editTransactionCategorySelect.value;
    
    if (isNaN(newAmount) || newAmount <= 0 || !newDate || !newDescription) {
        showErrorModal('Please fill out all fields with valid data.');
        return;
    }
    if (newType === 'expense' && !newCategoryId) {
        showErrorModal('Please select a category for expenses.');
        return;
    }
    
    let oldTransaction;
    let oldMonth;
    for (const monthKey in budgets) {
        const monthData = budgets[monthKey];
        const transactionIndex = monthData.transactions.findIndex(t => t.id === editingHistoricalTransactionId);
        if (transactionIndex !== -1) {
            oldTransaction = monthData.transactions[transactionIndex];
            oldMonth = monthKey;
            
            const updatedTransaction = { 
                ...oldTransaction, 
                date: newDate, 
                amount: newAmount, 
                type: newType, 
                description: newDescription, 
                categoryId: newCategoryId || null 
            };
            
            const newMonth = format(parseISO(newDate), 'yyyy-MM');
            if (newMonth !== oldMonth) {
                monthData.transactions.splice(transactionIndex, 1);
                const newMonthData = getMonthData(newMonth);
                newMonthData.transactions.push(updatedTransaction);
            } else {
                monthData.transactions[transactionIndex] = updatedTransaction;
            }
            
            if (oldTransaction.type === 'income') {
                readyToAssign -= oldTransaction.amount;
            }
            if (newType === 'income') {
                readyToAssign += newAmount;
            }

            break;
        }
    }
    
    editingHistoricalTransactionId = null;
    hideModal(editTransactionModal);
    renderUI();
    saveDataToFile();
});

// Continue with bulk transactions...
addBulkTransactionBtn.addEventListener('click', () => {
    bulkTransactionsTextarea.value = '';
    showModal(bulkTransactionModal);
});

addBulkTransactionsBtnModal.addEventListener('click', () => {
    const transactionsText = bulkTransactionsTextarea.value.trim();
    if (transactionsText === '') {
        showErrorModal('Please enter transactions to add.');
        return;
    }

    const lines = transactionsText.split('\n');
    let successCount = 0;
    let errorCount = 0;

    lines.forEach(line => {
        const parts = line.split(',').map(part => part.trim());
        if (parts.length === 5) {
            const [dateStr, amountStr, categoryName, description, type] = parts;
            const amount = parseFloat(amountStr);
            const date = parseISO(dateStr);
            
            if (isNaN(amount) || amount <= 0 || !date || !categoryName || !description || (type !== 'expense' && type !== 'income')) {
                console.error(`Invalid transaction format: ${line}`);
                errorCount++;
                return;
            }
            
            // Find category by name
            const category = Object.values(categories).find(cat => 
                cat.name.toLowerCase() === categoryName.toLowerCase() && cat.isActive
            );
            
            if (!category && type === 'expense') {
                console.error(`Category not found: ${categoryName}`);
                errorCount++;
                return;
            }
            
            const month = format(date, 'yyyy-MM');
            const monthData = getMonthData(month);

            const newTransaction = { 
                id: uuidv4(), 
                date: dateStr, 
                amount, 
                description, 
                type, 
                categoryId: category ? category.id : null 
            };
            
            if (!isDuplicateTransaction(newTransaction)) {
                monthData.transactions.push(newTransaction);
                updateReadyToAssign(newTransaction);
                successCount++;
            } else {
                console.warn(`Skipping duplicate transaction: ${line}`);
                errorCount++;
            }
        } else {
            console.error(`Invalid line format: ${line}`);
            errorCount++;
        }
    });

    if (successCount > 0) {
        hideModal(bulkTransactionModal);
        renderUI();
        saveDataToFile();
        console.log(`Successfully added ${successCount} transactions. Skipped ${errorCount} invalid/duplicate lines.`);
    } else {
        showErrorModal(`Failed to add any transactions. Please check the format and try again. Skipped ${errorCount} lines.`);
    }
});

// Continue with debt handlers...
addDebtBtn.addEventListener('click', () => {
    debtNameInput.value = '';
    debtOriginalBalanceInput.value = '';
    debtCurrentBalanceInput.value = '';
    debtInterestRateInput.value = '';
    debtMinPaymentInput.value = '';
    showModal(debtModal);
});

addDebtConfirmBtn.addEventListener('click', () => {
    const name = debtNameInput.value.trim();
    const originalBalance = parseFloat(debtOriginalBalanceInput.value);
    const currentBalance = parseFloat(debtCurrentBalanceInput.value);
    const interestRate = parseFloat(debtInterestRateInput.value);
    const minPayment = parseFloat(debtMinPaymentInput.value);

    if (!name || isNaN(originalBalance) || isNaN(currentBalance) || isNaN(interestRate) || isNaN(minPayment) || originalBalance <= 0 || currentBalance < 0) {
        showErrorModal('Please fill out all fields with valid data.');
        return;
    }

    debtList.push({ id: uuidv4(), name, originalBalance, currentBalance, interestRate, minPayment, paymentHistory: [] });

    hideModal(debtModal);
    renderUI();
    saveDataToFile();
});

window.handleRecordPayment = (debtId) => {
    selectedDebtId = debtId;
    const debt = debtList.find(d => d.id === debtId);
    if (debt) {
        paymentDebtName.textContent = debt.name;
        paymentAvailableFunds.textContent = formatCurrency(readyToAssign);
        paymentAmountInput.value = debt.minPayment;
        showModal(paymentModal);
    }
};

recordPaymentConfirmBtn.addEventListener('click', () => {
    const amount = parseFloat(paymentAmountInput.value);
    if (isNaN(amount) || amount <= 0) {
        showErrorModal('Please enter a valid payment amount.');
        return;
    }

    if (amount > readyToAssign) {
        showErrorModal('You do not have enough funds to make this payment.');
        return;
    }

    const debt = debtList.find(d => d.id === selectedDebtId);
    if (debt) {
        debt.currentBalance -= amount;
        if (debt.currentBalance < 0) debt.currentBalance = 0;
        debt.paymentHistory.push({ date: format(new Date(), 'yyyy-MM-dd'), amount });
        
        // Find or create "Debt Payments" category
        let debtPaymentCategory = Object.values(categories).find(cat => 
            cat.name === 'Debt Payments' && cat.isActive
        );
        
        if (!debtPaymentCategory) {
            const categoryId = addPersistentCategory('Debt Payments', 'Fixed Expenses');
            debtPaymentCategory = categories[categoryId];
        }
        
        const currentMonthData = getMonthData(currentMonth);
        currentMonthData.transactions.push({ 
            id: uuidv4(), 
            date: format(new Date(), 'yyyy-MM-dd'), 
            amount, 
            description: `Payment to ${debt.name}`, 
            type: 'expense', 
            categoryId: debtPaymentCategory.id 
        });

        readyToAssign -= amount;
        selectedDebtId = null;
        hideModal(paymentModal);
        renderUI();
        saveDataToFile();
    }
});

window.handleDeleteDebt = (debtId) => {
    if (confirm("Are you sure you want to delete this debt? This action cannot be undone.")) {
        debtList = debtList.filter(d => d.id !== debtId);
        renderUI();
        saveDataToFile();
    }
};

window.handleDeleteTransaction = (transactionId, month) => {
    if (confirm("Are you sure you want to delete this transaction?")) {
        const monthData = budgets[month];
        const transactionIndex = monthData.transactions.findIndex(t => t.id === transactionId);
        if (transactionIndex !== -1) {
            const transaction = monthData.transactions[transactionIndex];
            if (transaction.type === 'income') {
                readyToAssign -= transaction.amount;
            }
            monthData.transactions.splice(transactionIndex, 1);
            renderUI();
            saveDataToFile();
        }
    }
};

// Navigation handlers
prevMonthBtn.addEventListener('click', () => {
    currentMonth = format(subMonths(parseISO(currentMonth + '-01'), 1), 'yyyy-MM');
    renderUI();
});

nextMonthBtn.addEventListener('click', () => {
    currentMonth = format(addMonths(parseISO(currentMonth + '-01'), 1), 'yyyy-MM');
    renderUI();
});

// NEW: Updated copy categories handler
copyCategoriesBtn.addEventListener('click', () => {
    const nextMonth = format(addMonths(parseISO(currentMonth + '-01'), 1), 'yyyy-MM');
    const currentMonthData = getMonthData(currentMonth);
    const nextMonthData = getMonthData(nextMonth);
    
    let categoriesCopied = 0;
    
    // Copy all active categories to next month with zero assignments
    Object.values(categories).forEach(category => {
        if (category.isActive && !nextMonthData.categories[category.id]) {
            nextMonthData.categories[category.id] = { assigned: 0 };
            categoriesCopied++;
        }
    });
    
    if (categoriesCopied > 0) {
        renderUI();
        saveDataToFile();
        alert(`Copied ${categoriesCopied} categories to ${format(parseISO(nextMonth + '-01'), 'MMMM yyyy')}.`);
    } else {
        alert("All categories are already present in the next month.");
    }
});

// NEW: Updated quick budget handler
window.handleQuickBudget = (categoryId) => {
    const previousMonth = format(subMonths(parseISO(currentMonth + '-01'), 1), 'yyyy-MM');
    const previousMonthData = budgets[previousMonth];
    const currentMonthData = getMonthData(currentMonth);
    
    if (!previousMonthData || !previousMonthData.categories[categoryId]) {
        showErrorModal('No data found for this category in the previous month.');
        return;
    }
    
    const previousAssignedAmount = previousMonthData.categories[categoryId].assigned || 0;
    const currentAssignedAmount = currentMonthData.categories[categoryId]?.assigned || 0;
    const amountToAssign = previousAssignedAmount - currentAssignedAmount;
    
    if (amountToAssign <= 0) {
        showErrorModal('This category is already fully assigned or was not budgeted last month.');
        return;
    }
    
    if (readyToAssign < amountToAssign) {
        showErrorModal(`Not enough funds available to assign. You need ${formatCurrency(amountToAssign)} but only have ${formatCurrency(readyToAssign)}.`);
        return;
    }

    if (!currentMonthData.categories[categoryId]) {
        currentMonthData.categories[categoryId] = { assigned: 0 };
    }
    
    currentMonthData.categories[categoryId].assigned += amountToAssign;
    readyToAssign -= amountToAssign;
    
    renderUI();
    saveDataToFile();
};

// View handlers
budgetViewBtn.addEventListener('click', () => showView('budgetView'));
reportsViewBtn.addEventListener('click', () => showView('reportsView'));
historicalDataBtn.addEventListener('click', () => showView('historicalDataView'));

// Debt view handlers
debtSnowballBtn.addEventListener('click', () => {
    debtViewMethod = 'snowball';
    debtSnowballBtn.classList.add('active');
    debtAvalancheBtn.classList.remove('active');
    renderDebtTable();
});

debtAvalancheBtn.addEventListener('click', () => {
    debtViewMethod = 'avalanche';
    debtAvalancheBtn.classList.add('active');
    debtSnowballBtn.classList.remove('active');
    renderDebtTable();
});

// Export and file handlers
exportDataBtn.addEventListener('click', () => {
    const dataToExport = { budgets, debtList, goals, categories, readyToAssign };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget_data_export_${format(new Date(), 'yyyy-MM-dd')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

changeFileBtn.addEventListener('click', async () => {
    const data = await chooseNewDataFile();
    if (data) {
        budgets = data.monthlyBudgets || {};
        debtList = data.debtList || [];
        goals = data.goals || [];
        categories = data.categories || {}; // NEW: Load persistent categories
        readyToAssign = data.readyToAssign || 0;
        renderUI();
        showView('budgetView');
    }
});

// Close modal event listeners
closeGoalModalBtn.addEventListener('click', () => hideModal(goalModal));
closeAssignModalBtn.addEventListener('click', () => hideModal(assignModal));
closeTransactionModalBtn.addEventListener('click', () => hideModal(transactionModal));
closeEditTransactionModalBtn.addEventListener('click', () => hideModal(editTransactionModal));
closeBulkTransactionModalBtn.addEventListener('click', () => hideModal(bulkTransactionModal));
closeDebtModalBtn.addEventListener('click', () => hideModal(debtModal));
closePaymentModalBtn.addEventListener('click', () => hideModal(paymentModal));
closeErrorModalBtn.addEventListener('click', () => hideModal(errorModal));

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    const initApp = (data) => {
        budgets = data.monthlyBudgets || {};
        debtList = data.debtList || [];
        goals = data.goals || [];
        categories = data.categories || {}; // NEW: Load persistent categories
        readyToAssign = data.readyToAssign || 0;
        
        // Migration: Convert old category structure to new persistent structure
        if (Object.keys(categories).length === 0) {
            migrateOldCategories();
        }
        
        loadingOverlay.style.display = 'none';
        appContainer.style.display = 'block';
        renderUI();
        showView('budgetView');
        transactionDateInput.value = format(new Date(), 'yyyy-MM-dd');
    };
    
    // NEW: Migration function for existing data
    const migrateOldCategories = () => {
        const allCategoryNames = new Set();
        const categoryParents = {};
        
        // Collect all unique categories and their parent relationships
        for (const monthKey in budgets) {
            const monthData = budgets[monthKey];
            for (const categoryName in monthData.categories) {
                allCategoryNames.add(categoryName);
                if (monthData.categories[categoryName].parentCategory) {
                    categoryParents[categoryName] = monthData.categories[categoryName].parentCategory;
                }
            }
        }
        
        // Create persistent categories
        const categoryMapping = {};
        allCategoryNames.forEach(categoryName => {
            const categoryId = uuidv4();
            categories[categoryId] = {
                id: categoryId,
                name: categoryName,
                parentCategory: categoryParents[categoryName] || '',
                createdDate: format(new Date(), 'yyyy-MM-dd'),
                isActive: true
            };
            categoryMapping[categoryName] = categoryId;
        });
        
        // Update monthly data to use category IDs
        for (const monthKey in budgets) {
            const monthData = budgets[monthKey];
            const newCategories = {};
            
            for (const categoryName in monthData.categories) {
                const categoryId = categoryMapping[categoryName];
                if (categoryId) {
                    newCategories[categoryId] = {
                        assigned: monthData.categories[categoryName].assigned || 0
                    };
                }
            }
            
            monthData.categories = newCategories;
            
            // Update transactions to use category IDs
            monthData.transactions.forEach(transaction => {
                if (transaction.category && categoryMapping[transaction.category]) {
                    transaction.categoryId = categoryMapping[transaction.category];
                    delete transaction.category; // Remove old category field
                }
            });
        }
        
        console.log('Migrated categories to new persistent structure');
        saveDataToFile();
    };

    const selectExistingFile = async () => {
        try {
            [fileHandle] = await window.showOpenFilePicker({
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
                multiple: false
            });
            const data = await readFile();
            if (!data || typeof data !== 'object' || !('monthlyBudgets' in data)) {
                showErrorModal('The selected file is invalid or corrupted.');
                loadingOverlay.style.display = 'flex'; 
                return;
            }
            await saveFileHandle(fileHandle);
            initApp(data);
        } catch (err) {
            if (err.name !== 'AbortError') {
                showErrorModal(`File selection failed: ${err.message}`);
            }
            console.error('File selection or reading failed:', err);
            loadingOverlay.style.display = 'flex'; 
        }
    };

    const createNewFile = async () => {
        try {
            const defaultName = prompt('Enter a name for your new budget file (without extension):', 'budgetData');
            if (!defaultName) {
                loadingOverlay.style.display = 'flex';
                return;
            }

            fileHandle = await window.showSaveFilePicker({
                suggestedName: `${defaultName}.json`,
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
            });

            const initialData = { 
                monthlyBudgets: {}, 
                debtList: [], 
                goals: [], 
                categories: {}, // NEW: Include persistent categories
                readyToAssign: 0 
            };
            await writeFile(initialData);
            await saveFileHandle(fileHandle);
            initApp(initialData);
        } catch (err) {
            if (err.name !== 'AbortError') {
                showErrorModal(`File creation failed: ${err.message}`);
            }
            console.error('File creation failed:', err);
            loadingOverlay.style.display = 'flex';
        }
    };

    document.getElementById('selectFileBtn').addEventListener('click', selectExistingFile);
    document.getElementById('createFileBtn').addEventListener('click', createNewFile);
    
    const storedHandle = await getFileHandleFromDB();
    if (storedHandle) {
        fileHandle = storedHandle;
        try {
            const data = await readFile();
            if (data) {
                initApp(data);
            } else {
                throw new Error('Could not read data from stored file handle.');
            }
        } catch (err) {
            console.error('Error reading stored file handle, asking user to select new file.', err);
            loadingOverlay.style.display = 'flex';
        }
    } else {
        loadingOverlay.style.display = 'flex';
    }
});

