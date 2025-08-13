// Date-fns functions for easy date manipulation
import { format, parseISO, addMonths, subMonths, differenceInCalendarMonths, startOfMonth } from "https://cdn.skypack.dev/date-fns";
import { v4 as uuidv4 } from "https://jspm.dev/uuid";

// --- GLOBAL STATE ---
const state = {
    budgets: {},
    debtList: [],
    goals: [],
    categories: {},
    currentMonth: format(new Date(), 'yyyy-MM'),
    readyToAssign: 0,
    debtViewMethod: 'snowball',
    selectedDebtId: null,
    editingHistoricalTransactionId: null,
    fileHandle: null
};

// --- UTILITIES ---
const $ = id => document.getElementById(id);
const $$ = selector => document.querySelectorAll(selector);
const createElement = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    Object.assign(el, props);
    children.forEach(child => el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child));
    return el;
};

const formatCurrency = amount => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
}).format(amount);

const parseAmount = str => parseFloat(str.replace(/[^0-9.-]/g, '')) || 0;

// --- DATABASE OPERATIONS ---
const db = {
    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('budget-app-db', 1);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles');
                }
            };
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e.target.error);
        });
    },

    async saveHandle(handle) {
        try {
            const database = await this.open();
            const tx = database.transaction('handles', 'readwrite');
            await tx.objectStore('handles').put(handle, 'budgetFile');
        } catch (error) {
            console.error('Error saving file handle:', error);
            showErrorModal('Could not save file reference. Your browser may be in private mode.');
        }
    },

    async getHandle() {
        try {
            const database = await this.open();
            const tx = database.transaction('handles', 'readonly');
            return await new Promise((resolve, reject) => {
                const request = tx.objectStore('handles').get('budgetFile');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting file handle:', error);
            return null;
        }
    }
};

// --- FILE OPERATIONS ---
const fileOps = {
    async chooseNew() {
        try {
            state.fileHandle = await window.showSaveFilePicker({
                suggestedName: 'budgetData.json',
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
            });
            await db.saveHandle(state.fileHandle);
            const initialData = { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
            await this.write(initialData);
            return initialData;
        } catch (error) {
            showErrorModal("File selection cancelled. App will run without persistent storage.");
            return { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
        }
    },

    async read() {
        if (!state.fileHandle) return { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
        try {
            const file = await state.fileHandle.getFile();
            const contents = await file.text();
            return JSON.parse(contents || '{}');
        } catch (error) {
            showErrorModal("Error reading data file. May be corrupted.");
            return { monthlyBudgets: {}, debtList: [], goals: [], categories: {}, readyToAssign: 0 };
        }
    },

    async write(data) {
        if (!state.fileHandle) {
            showErrorModal("No data file selected.");
            return;
        }
        try {
            const writable = await state.fileHandle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                showErrorModal("Permission denied. Please select a new file.");
                state.fileHandle = null;
            } else {
                showErrorModal("Could not save data.");
            }
        }
    }
};

// --- DATA MANAGEMENT ---
const dataManager = {
    async save() {
        const data = {
            monthlyBudgets: state.budgets,
            debtList: state.debtList,
            goals: state.goals,
            categories: state.categories,
            readyToAssign: state.readyToAssign
        };
        await fileOps.write(data);
    },

    async load() {
        state.fileHandle = await db.getHandle();
        const data = await fileOps.read();
        
        Object.assign(state, {
            budgets: data.monthlyBudgets || {},
            debtList: data.debtList || [],
            goals: data.goals || [],
            categories: data.categories || {},
            readyToAssign: data.readyToAssign || 0
        });

        this.ensureCurrentMonth();
        ui.updateAll();
    },

    ensureCurrentMonth() {
        if (!state.budgets[state.currentMonth]) {
            state.budgets[state.currentMonth] = { categories: {}, transactions: [] };
        }
    }
};

// --- BUDGET OPERATIONS ---
const budget = {
    getCurrentBudget() {
        return state.budgets[state.currentMonth] || { categories: {}, transactions: [] };
    },

    addCategory(name, budgetedAmount = 0) {
        const budget = this.getCurrentBudget();
        const categoryId = uuidv4();
        
        budget.categories[categoryId] = {
            id: categoryId,
            name,
            budgeted: budgetedAmount,
            activity: 0,
            available: budgetedAmount
        };

        state.categories[categoryId] = { id: categoryId, name };
        state.readyToAssign -= budgetedAmount;
        
        dataManager.save();
        ui.updateAll();
    },

    updateCategory(categoryId, field, value) {
        const budget = this.getCurrentBudget();
        const category = budget.categories[categoryId];
        
        if (!category) return;

        const oldValue = category[field];
        category[field] = parseAmount(value);
        
        if (field === 'budgeted') {
            const difference = category.budgeted - oldValue;
            state.readyToAssign -= difference;
            category.available = category.budgeted + category.activity;
        }

        dataManager.save();
        ui.updateBudgetTable();
        ui.updateReadyToAssign();
    },

    deleteCategory(categoryId) {
        const budget = this.getCurrentBudget();
        const category = budget.categories[categoryId];
        
        if (category) {
            state.readyToAssign += category.budgeted;
            delete budget.categories[categoryId];
            delete state.categories[categoryId];
        }

        dataManager.save();
        ui.updateAll();
    },

    addTransaction(categoryId, description, amount) {
        const budget = this.getCurrentBudget();
        const category = budget.categories[categoryId];
        
        if (!category) return;

        const transaction = {
            id: uuidv4(),
            categoryId,
            description,
            amount: parseAmount(amount),
            date: new Date().toISOString()
        };

        budget.transactions.push(transaction);
        category.activity += transaction.amount;
        category.available = category.budgeted + category.activity;

        dataManager.save();
        ui.updateAll();
    }
};

// --- DEBT OPERATIONS ---
const debt = {
    add(name, balance, minPayment, interestRate) {
        const debtItem = {
            id: uuidv4(),
            name,
            balance: parseAmount(balance),
            minPayment: parseAmount(minPayment),
            interestRate: parseFloat(interestRate) || 0,
            payments: []
        };

        state.debtList.push(debtItem);
        dataManager.save();
        ui.updateDebtTable();
    },

    addPayment(debtId, amount, date = new Date()) {
        const debtItem = state.debtList.find(d => d.id === debtId);
        if (!debtItem) return;

        const payment = {
            id: uuidv4(),
            amount: parseAmount(amount),
            date: date.toISOString()
        };

        debtItem.payments.push(payment);
        debtItem.balance -= payment.amount;

        dataManager.save();
        ui.updateDebtTable();
    },

    getSortedDebts() {
        return [...state.debtList].sort((a, b) => {
            return state.debtViewMethod === 'snowball' 
                ? a.balance - b.balance 
                : b.interestRate - a.interestRate;
        });
    }
};

// --- GOALS OPERATIONS ---
const goals = {
    add(name, targetAmount, targetDate) {
        const goal = {
            id: uuidv4(),
            name,
            targetAmount: parseAmount(targetAmount),
            targetDate,
            currentAmount: 0,
            contributions: []
        };

        state.goals.push(goal);
        dataManager.save();
        ui.updateGoalsTable();
    },

    addContribution(goalId, amount) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        const contribution = {
            id: uuidv4(),
            amount: parseAmount(amount),
            date: new Date().toISOString()
        };

        goal.contributions.push(contribution);
        goal.currentAmount += contribution.amount;

        dataManager.save();
        ui.updateGoalsTable();
    }
};

// --- UI OPERATIONS ---
const ui = {
    updateAll() {
        this.updateBudgetTable();
        this.updateReadyToAssign();
        this.updateDebtTable();
        this.updateGoalsTable();
        this.updateMonthDisplay();
    },

    updateReadyToAssign() {
        const element = $('ready-to-assign-amount');
        if (element) {
            element.textContent = formatCurrency(state.readyToAssign);
            element.className = state.readyToAssign >= 0 ? 'positive' : 'negative';
        }
    },

    updateMonthDisplay() {
        const element = $('current-month');
        if (element) {
            element.textContent = format(parseISO(state.currentMonth + '-01'), 'MMMM yyyy');
        }
    },

    updateBudgetTable() {
        const tbody = $('budget-table-body');
        if (!tbody) return;

        const budget = state.budgets[state.currentMonth] || { categories: {} };
        tbody.innerHTML = '';

        Object.values(budget.categories).forEach(category => {
            const row = createElement('tr', {}, [
                createElement('td', {}, [category.name]),
                createElement('td', {}, [
                    createElement('input', {
                        type: 'number',
                        value: category.budgeted,
                        onchange: e => budget.updateCategory(category.id, 'budgeted', e.target.value)
                    })
                ]),
                createElement('td', {}, [formatCurrency(category.activity)]),
                createElement('td', { className: category.available >= 0 ? 'positive' : 'negative' }, [
                    formatCurrency(category.available)
                ]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showTransactionModal(category.id)
                    }, ['Add Transaction']),
                    createElement('button', {
                        onclick: () => budget.deleteCategory(category.id)
                    }, ['Delete'])
                ])
            ]);
            tbody.appendChild(row);
        });
    },

    updateDebtTable() {
        const tbody = $('debt-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        debt.getSortedDebts().forEach((debtItem, index) => {
            const row = createElement('tr', {}, [
                createElement('td', {}, [debtItem.name]),
                createElement('td', {}, [formatCurrency(debtItem.balance)]),
                createElement('td', {}, [formatCurrency(debtItem.minPayment)]),
                createElement('td', {}, [`${debtItem.interestRate}%`]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showPaymentModal(debtItem.id)
                    }, ['Add Payment'])
                ])
            ]);
            tbody.appendChild(row);
        });
    },

    updateGoalsTable() {
        const tbody = $('goals-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        state.goals.forEach(goal => {
            const progress = (goal.currentAmount / goal.targetAmount) * 100;
            const row = createElement('tr', {}, [
                createElement('td', {}, [goal.name]),
                createElement('td', {}, [formatCurrency(goal.targetAmount)]),
                createElement('td', {}, [formatCurrency(goal.currentAmount)]),
                createElement('td', {}, [`${progress.toFixed(1)}%`]),
                createElement('td', {}, [format(parseISO(goal.targetDate), 'MMM dd, yyyy')]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showContributionModal(goal.id)
                    }, ['Add Contribution'])
                ])
            ]);
            tbody.appendChild(row);
        });
    },

    // Modal operations
    showTransactionModal(categoryId) {
        state.selectedCategoryId = categoryId;
        $('transaction-modal').style.display = 'block';
    },

    showPaymentModal(debtId) {
        state.selectedDebtId = debtId;
        $('payment-modal').style.display = 'block';
    },

    showContributionModal(goalId) {
        state.selectedGoalId = goalId;
        $('contribution-modal').style.display = 'block';
    }
};

// --- EVENT HANDLERS ---
const handlers = {
    init() {
        // Navigation
        $('prev-month')?.addEventListener('click', () => this.changeMonth(-1));
        $('next-month')?.addEventListener('click', () => this.changeMonth(1));

        // File operations
        $('new-file-btn')?.addEventListener('click', async () => {
            await fileOps.chooseNew();
            await dataManager.load();
        });

        // Add forms
        $('add-category-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            budget.addCategory(formData.get('name'), formData.get('budgeted'));
            e.target.reset();
        });

        $('add-debt-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            debt.add(
                formData.get('name'),
                formData.get('balance'),
                formData.get('minPayment'),
                formData.get('interestRate')
            );
            e.target.reset();
        });

        // Modal handlers
        $$('.modal .close').forEach(closeBtn => {
            closeBtn.addEventListener('click', e => {
                e.target.closest('.modal').style.display = 'none';
            });
        });

        // Click outside modal to close
        window.addEventListener('click', e => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
    },

    changeMonth(direction) {
        const currentDate = parseISO(state.currentMonth + '-01');
        const newDate = direction > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
        state.currentMonth = format(newDate, 'yyyy-MM');
        dataManager.ensureCurrentMonth();
        ui.updateAll();
    }
};

// --- ERROR HANDLING ---
function showErrorModal(message) {
    const modal = $('error-modal');
    const messageEl = $('error-message');
    if (modal && messageEl) {
        messageEl.textContent = message;
        modal.style.display = 'block';
    } else {
        alert(message); // Fallback
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    handlers.init();
    await dataManager.load();
});
