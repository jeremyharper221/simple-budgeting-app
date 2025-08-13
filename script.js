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
    selectedCategoryId: null,
    selectedGoalId: null,
    editingTransactionId: null,
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

const validateInput = (value, type = 'number', required = true) => {
    if (required && (!value || value.toString().trim() === '')) {
        throw new Error('This field is required');
    }
    if (type === 'number' && isNaN(parseAmount(value))) {
        throw new Error('Please enter a valid number');
    }
    if (type === 'email' && !/\S+@\S+\.\S+/.test(value)) {
        throw new Error('Please enter a valid email');
    }
    return true;
};

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

    async chooseExisting() {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
            });
            state.fileHandle = fileHandle;
            await db.saveHandle(fileHandle);
            return await this.read();
        } catch (error) {
            showErrorModal("File selection cancelled.");
            return null;
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
    },

    async export() {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: `budget-export-${format(new Date(), 'yyyy-MM-dd')}.json`,
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
            });
            const data = {
                monthlyBudgets: state.budgets,
                debtList: state.debtList,
                goals: state.goals,
                categories: state.categories,
                readyToAssign: state.readyToAssign,
                exportDate: new Date().toISOString()
            };
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
            showSuccessMessage('Data exported successfully!');
        } catch (error) {
            showErrorModal('Export cancelled or failed.');
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
        this.migrateData();
        ui.updateAll();
    },

    ensureCurrentMonth() {
        if (!state.budgets[state.currentMonth]) {
            state.budgets[state.currentMonth] = { categories: {}, transactions: [] };
        }
    },

    // Migrate old data format to new format
    migrateData() {
        Object.keys(state.budgets).forEach(monthKey => {
            const monthBudget = state.budgets[monthKey];
            if (!monthBudget.transactions) {
                monthBudget.transactions = [];
            }
            // Ensure all categories have required fields
            Object.values(monthBudget.categories || {}).forEach(category => {
                if (typeof category.available === 'undefined') {
                    category.available = category.budgeted + (category.activity || 0);
                }
            });
        });
    }
};

// --- BUDGET OPERATIONS ---
const budget = {
    getCurrentBudget() {
        return state.budgets[state.currentMonth] || { categories: {}, transactions: [] };
    },

    addCategory(name, budgetedAmount = 0) {
        try {
            validateInput(name, 'string');
            validateInput(budgetedAmount, 'number', false);
            
            const budget = this.getCurrentBudget();
            const categoryId = uuidv4();
            const amount = parseAmount(budgetedAmount);
            
            budget.categories[categoryId] = {
                id: categoryId,
                name: name.trim(),
                budgeted: amount,
                activity: 0,
                available: amount
            };

            state.categories[categoryId] = { id: categoryId, name: name.trim() };
            state.readyToAssign -= amount;
            
            dataManager.save();
            ui.updateAll();
            showSuccessMessage(`Category "${name}" added successfully!`);
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    updateCategory(categoryId, field, value) {
        try {
            validateInput(value, 'number');
            
            const budget = this.getCurrentBudget();
            const category = budget.categories[categoryId];
            
            if (!category) throw new Error('Category not found');

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
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    deleteCategory(categoryId) {
        if (!confirm('Are you sure you want to delete this category? This will also delete all associated transactions.')) {
            return;
        }

        const budget = this.getCurrentBudget();
        const category = budget.categories[categoryId];
        
        if (category) {
            state.readyToAssign += category.budgeted;
            delete budget.categories[categoryId];
            delete state.categories[categoryId];
            
            // Remove associated transactions
            budget.transactions = budget.transactions.filter(t => t.categoryId !== categoryId);
        }

        dataManager.save();
        ui.updateAll();
        showSuccessMessage('Category deleted successfully!');
    },

    addTransaction(categoryId, description, amount) {
        try {
            validateInput(description, 'string');
            validateInput(amount, 'number');
            
            const budget = this.getCurrentBudget();
            const category = budget.categories[categoryId];
            
            if (!category) throw new Error('Category not found');

            const transaction = {
                id: uuidv4(),
                categoryId,
                description: description.trim(),
                amount: parseAmount(amount),
                date: new Date().toISOString()
            };

            budget.transactions.push(transaction);
            category.activity += transaction.amount;
            category.available = category.budgeted + category.activity;

            dataManager.save();
            ui.updateAll();
            ui.closeModal('transaction-modal');
            showSuccessMessage('Transaction added successfully!');
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    editTransaction(transactionId, description, amount) {
        try {
            validateInput(description, 'string');
            validateInput(amount, 'number');
            
            const budget = this.getCurrentBudget();
            const transaction = budget.transactions.find(t => t.id === transactionId);
            if (!transaction) throw new Error('Transaction not found');
            
            const category = budget.categories[transaction.categoryId];
            category.activity -= transaction.amount; // Remove old amount
            
            transaction.amount = parseAmount(amount);
            transaction.description = description.trim();
            
            category.activity += transaction.amount; // Add new amount
            category.available = category.budgeted + category.activity;
            
            dataManager.save();
            ui.updateAll();
            ui.closeModal('edit-transaction-modal');
            showSuccessMessage('Transaction updated successfully!');
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    deleteTransaction(transactionId) {
        if (!confirm('Are you sure you want to delete this transaction?')) return;
        
        const budget = this.getCurrentBudget();
        const transactionIndex = budget.transactions.findIndex(t => t.id === transactionId);
        if (transactionIndex === -1) return;
        
        const transaction = budget.transactions[transactionIndex];
        const category = budget.categories[transaction.categoryId];
        
        category.activity -= transaction.amount;
        category.available = category.budgeted + category.activity;
        
        budget.transactions.splice(transactionIndex, 1);
        
        dataManager.save();
        ui.updateAll();
        showSuccessMessage('Transaction deleted successfully!');
    },

    getTransactionHistory(categoryId) {
        const budget = this.getCurrentBudget();
        return budget.transactions
            .filter(t => t.categoryId === categoryId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    getAllTransactions() {
        const budget = this.getCurrentBudget();
        return budget.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
};

// --- DEBT OPERATIONS ---
const debt = {
    add(name, balance, minPayment, interestRate) {
        try {
            validateInput(name, 'string');
            validateInput(balance, 'number');
            validateInput(minPayment, 'number');
            validateInput(interestRate, 'number', false);
            
            const debtItem = {
                id: uuidv4(),
                name: name.trim(),
                balance: parseAmount(balance),
                minPayment: parseAmount(minPayment),
                interestRate: parseFloat(interestRate) || 0,
                payments: []
            };

            state.debtList.push(debtItem);
            dataManager.save();
            ui.updateDebtTable();
            showSuccessMessage(`Debt "${name}" added successfully!`);
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    addPayment(debtId, amount, date = new Date()) {
        try {
            validateInput(amount, 'number');
            
            const debtItem = state.debtList.find(d => d.id === debtId);
            if (!debtItem) throw new Error('Debt not found');

            const paymentAmount = parseAmount(amount);
            if (paymentAmount > debtItem.balance) {
                if (!confirm(`Payment amount (${formatCurrency(paymentAmount)}) is greater than remaining balance (${formatCurrency(debtItem.balance)}). Continue?`)) {
                    return;
                }
            }

            const payment = {
                id: uuidv4(),
                amount: paymentAmount,
                date: date.toISOString()
            };

            debtItem.payments.push(payment);
            debtItem.balance = Math.max(0, debtItem.balance - payment.amount);

            dataManager.save();
            ui.updateDebtTable();
            ui.closeModal('payment-modal');
            showSuccessMessage('Payment added successfully!');
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    deleteDebt(debtId) {
        if (!confirm('Are you sure you want to delete this debt? This will also delete all payment history.')) {
            return;
        }
        
        const index = state.debtList.findIndex(d => d.id === debtId);
        if (index !== -1) {
            state.debtList.splice(index, 1);
            dataManager.save();
            ui.updateDebtTable();
            showSuccessMessage('Debt deleted successfully!');
        }
    },

    getSortedDebts() {
        return [...state.debtList].sort((a, b) => {
            return state.debtViewMethod === 'snowball' 
                ? a.balance - b.balance 
                : b.interestRate - a.interestRate;
        });
    },

    getPaymentHistory(debtId) {
        const debtItem = state.debtList.find(d => d.id === debtId);
        return debtItem ? debtItem.payments.sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
    },

    getTotalDebt() {
        return state.debtList.reduce((total, debt) => total + debt.balance, 0);
    },

    getTotalMinPayments() {
        return state.debtList.reduce((total, debt) => total + debt.minPayment, 0);
    }
};

// --- GOALS OPERATIONS ---
const goals = {
    add(name, targetAmount, targetDate) {
        try {
            validateInput(name, 'string');
            validateInput(targetAmount, 'number');
            validateInput(targetDate, 'string');
            
            const goal = {
                id: uuidv4(),
                name: name.trim(),
                targetAmount: parseAmount(targetAmount),
                targetDate,
                currentAmount: 0,
                contributions: []
            };

            state.goals.push(goal);
            dataManager.save();
            ui.updateGoalsTable();
            showSuccessMessage(`Goal "${name}" added successfully!`);
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    addContribution(goalId, amount) {
        try {
            validateInput(amount, 'number');
            
            const goal = state.goals.find(g => g.id === goalId);
            if (!goal) throw new Error('Goal not found');

            const contribution = {
                id: uuidv4(),
                amount: parseAmount(amount),
                date: new Date().toISOString()
            };

            goal.contributions.push(contribution);
            goal.currentAmount += contribution.amount;

            dataManager.save();
            ui.updateGoalsTable();
            ui.closeModal('contribution-modal');
            showSuccessMessage('Contribution added successfully!');
        } catch (error) {
            showErrorModal(error.message);
        }
    },

    deleteGoal(goalId) {
        if (!confirm('Are you sure you want to delete this goal? This will also delete all contribution history.')) {
            return;
        }
        
        const index = state.goals.findIndex(g => g.id === goalId);
        if (index !== -1) {
            state.goals.splice(index, 1);
            dataManager.save();
            ui.updateGoalsTable();
            showSuccessMessage('Goal deleted successfully!');
        }
    },

    getMonthlyContributionNeeded(goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return 0;
        
        const remaining = goal.targetAmount - goal.currentAmount;
        const monthsLeft = differenceInCalendarMonths(parseISO(goal.targetDate), new Date());
        
        return monthsLeft > 0 ? remaining / monthsLeft : remaining;
    },

    getContributionHistory(goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        return goal ? goal.contributions.sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
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
        this.updateSummaryStats();
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

    updateSummaryStats() {
        const totalBudgeted = Object.values(budget.getCurrentBudget().categories || {})
            .reduce((sum, cat) => sum + cat.budgeted, 0);
        const totalActivity = Object.values(budget.getCurrentBudget().categories || {})
            .reduce((sum, cat) => sum + cat.activity, 0);
        
        const budgetedEl = $('total-budgeted');
        const activityEl = $('total-activity');
        
        if (budgetedEl) budgetedEl.textContent = formatCurrency(totalBudgeted);
        if (activityEl) activityEl.textContent = formatCurrency(totalActivity);
    },

    updateBudgetTable() {
        const tbody = $('budget-table-body');
        if (!tbody) return;

        const currentBudget = budget.getCurrentBudget();
        tbody.innerHTML = '';

        Object.values(currentBudget.categories).forEach(category => {
            const row = createElement('tr', {}, [
                createElement('td', {}, [category.name]),
                createElement('td', {}, [
                    createElement('input', {
                        type: 'number',
                        value: category.budgeted,
                        step: '0.01',
                        onchange: e => budget.updateCategory(category.id, 'budgeted', e.target.value)
                    })
                ]),
                createElement('td', {}, [formatCurrency(category.activity)]),
                createElement('td', { className: category.available >= 0 ? 'positive' : 'negative' }, [
                    formatCurrency(category.available)
                ]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showTransactionModal(category.id),
                        className: 'btn-primary'
                    }, ['Add Transaction']),
                    createElement('button', {
                        onclick: () => this.showTransactionHistory(category.id),
                        className: 'btn-secondary'
                    }, ['History']),
                    createElement('button', {
                        onclick: () => budget.deleteCategory(category.id),
                        className: 'btn-danger'
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
                createElement('td', {}, [
                    createElement('span', {}, [`${index + 1}. ${debtItem.name}`])
                ]),
                createElement('td', {}, [formatCurrency(debtItem.balance)]),
                createElement('td', {}, [formatCurrency(debtItem.minPayment)]),
                createElement('td', {}, [`${debtItem.interestRate}%`]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showPaymentModal(debtItem.id),
                        className: 'btn-primary'
                    }, ['Add Payment']),
                    createElement('button', {
                        onclick: () => this.showPaymentHistory(debtItem.id),
                        className: 'btn-secondary'
                    }, ['History']),
                    createElement('button', {
                        onclick: () => debt.deleteDebt(debtItem.id),
                        className: 'btn-danger'
                    }, ['Delete'])
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
            const monthlyNeeded = goals.getMonthlyContributionNeeded(goal.id);
            
            const row = createElement('tr', {}, [
                createElement('td', {}, [goal.name]),
                createElement('td', {}, [formatCurrency(goal.targetAmount)]),
                createElement('td', {}, [formatCurrency(goal.currentAmount)]),
                createElement('td', {}, [
                    createElement('div', { className: 'progress-bar' }, [
                        createElement('div', { 
                            className: 'progress-fill',
                            style: `width: ${Math.min(progress, 100)}%`
                        }, [`${progress.toFixed(1)}%`])
                    ])
                ]),
                createElement('td', {}, [format(parseISO(goal.targetDate), 'MMM dd, yyyy')]),
                createElement('td', {}, [formatCurrency(monthlyNeeded)]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showContributionModal(goal.id),
                        className: 'btn-primary'
                    }, ['Add Contribution']),
                    createElement('button', {
                        onclick: () => this.showContributionHistory(goal.id),
                        className: 'btn-secondary'
                    }, ['History']),
                    createElement('button', {
                        onclick: () => goals.deleteGoal(goal.id),
                        className: 'btn-danger'
                    }, ['Delete'])
                ])
            ]);
            tbody.appendChild(row);
        });
    },

    // Modal operations
    showTransactionModal(categoryId) {
        state.selectedCategoryId = categoryId;
        const category = budget.getCurrentBudget().categories[categoryId];
        $('transaction-category-name').textContent = category?.name || 'Unknown';
        $('transaction-modal').style.display = 'block';
        $('transaction-description').focus();
    },

    showPaymentModal(debtId) {
        state.selectedDebtId = debtId;
        const debtItem = state.debtList.find(d => d.id === debtId);
        $('payment-debt-name').textContent = debtItem?.name || 'Unknown';
        $('payment-modal').style.display = 'block';
        $('payment-amount').focus();
    },

    showContributionModal(goalId) {
        state.selectedGoalId = goalId;
        const goal = state.goals.find(g => g.id === goalId);
        $('contribution-goal-name').textContent = goal?.name || 'Unknown';
        $('contribution-modal').style.display = 'block';
        $('contribution-amount').focus();
    },

    showTransactionHistory(categoryId) {
        const transactions = budget.getTransactionHistory(categoryId);
        const category = budget.getCurrentBudget().categories[categoryId];
        
        $('history-title').textContent = `Transaction History - ${category.name}`;
        const tbody = $('history-table-body');
        tbody.innerHTML = '';
        
        transactions.forEach(transaction => {
            const row = createElement('tr', {}, [
                createElement('td', {}, [format(parseISO(transaction.date), 'MMM dd, yyyy')]),
                createElement('td', {}, [transaction.description]),
                createElement('td', { className: transaction.amount >= 0 ? 'positive' : 'negative' }, [
                    formatCurrency(transaction.amount)
                ]),
                createElement('td', {}, [
                    createElement('button', {
                        onclick: () => this.showEditTransactionModal(transaction.id),
                        className: 'btn-secondary'
                    }, ['Edit']),
                    createElement('button', {
                        onclick: () => budget.deleteTransaction(transaction.id),
                        className: 'btn-danger'
                    }, ['Delete'])
                ])
            ]);
            tbody.appendChild(row);
        });
        
        $('history-modal').style.display = 'block';
    },

    showEditTransactionModal(transactionId) {
        const transaction = budget.getAllTransactions().find(t => t.id === transactionId);
        if (!transaction) return;
        
        state.editingTransactionId = transactionId;
        $('edit-transaction-description').value = transaction.description;
        $('edit-transaction-amount').value = transaction.amount;
        $('edit-transaction-modal').style.display = 'block';
        this.closeModal('history-modal');
    },

    closeModal(modalId) {
        const modal = $(modalId);
        if (modal) {
            modal.style.display = 'none';
            // Clear form data
            const forms = modal.querySelectorAll('form');
            forms.forEach(form => form.reset());
        }
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
        
        $('open-file-btn')?.addEventListener('click', async () => {
            const data = await fileOps.chooseExisting();
            if (data) await dataManager.load();
        });
        
        $('export-btn')?.addEventListener('click', () => fileOps.export());

        // Debt view toggle
        $('debt-view-toggle')?.addEventListener('change', e => {
            state.debtViewMethod = e.target.value;
            ui.updateDebtTable();
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

        $('add-goal-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            goals.add(
                formData.get('name'),
                formData.get('targetAmount'),
                formData.get('targetDate')
            );
            e.target.reset();
        });

        // Modal forms
        $('transaction-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            budget.addTransaction(
                state.selectedCategoryId,
                formData.get('description'),
                formData.get('amount')
            );
        });

        $('payment-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            debt.addPayment(state.selectedDebtId, formData.get('amount'));
        });

        $('contribution-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            goals.addContribution(state.selectedGoalId, formData.get('amount'));
        });

        $('edit-transaction-form')?.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            budget.editTransaction(
                state.editingTransactionId,
                formData.get('description'),
                formData.get('amount')
            );
        });

        // Modal handlers
        $$('.modal .close').forEach(closeBtn => {
            closeBtn.addEventListener('click', e => {
                const modal = e.target.closest('.modal');
                this.closeModal(modal.id);
            });
        });

        // Click outside modal to close
        window.addEventListener('click', e => {
            if (e.target.classList.contains('modal')) {
                ui.closeModal(e.target.id);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                $$('.modal[style*="block"]').forEach(modal => {
                    ui.closeModal(modal.id);
                });
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

// --- NOTIFICATION SYSTEM ---
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

function showSuccessMessage(message) {
    const notification = createElement('div', {
        className: 'success-notification',
        textContent: message
    });
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    handlers.init();
    await dataManager.load();
});

// --- EXPORT FOR TESTING ---
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { budget, debt, goals, dataManager, formatCurrency, parseAmount };
}
