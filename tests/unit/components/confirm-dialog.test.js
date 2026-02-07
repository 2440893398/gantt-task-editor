/**
 * Unit tests for confirm-dialog component
 * Source: src/components/common/confirm-dialog.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/dom.js', () => ({
    escapeHtml: vi.fn((text) => String(text))
}));

import { showConfirmDialog, closeConfirmDialog } from '../../../src/components/common/confirm-dialog.js';

describe('confirm-dialog', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        // Clean up any remaining dialogs
        closeConfirmDialog();
        vi.advanceTimersByTime(300);
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    describe('showConfirmDialog', () => {
        it('creates backdrop element with correct id', () => {
            showConfirmDialog({});

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            expect(backdrop).not.toBeNull();
            expect(backdrop.tagName).toBe('DIV');
        });

        it('contains confirm and cancel buttons with correct text', () => {
            showConfirmDialog({
                confirmText: 'Delete',
                cancelText: 'Keep'
            });

            const cancelBtn = document.getElementById('confirm-dialog-cancel');
            const confirmBtn = document.getElementById('confirm-dialog-ok');
            expect(cancelBtn).not.toBeNull();
            expect(confirmBtn).not.toBeNull();
            expect(cancelBtn.textContent).toBe('Keep');
            expect(confirmBtn.textContent).toBe('Delete');
        });

        it('shows title and message', () => {
            showConfirmDialog({
                title: 'Delete Task',
                message: 'This action cannot be undone.'
            });

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            expect(backdrop.innerHTML).toContain('Delete Task');
            expect(backdrop.innerHTML).toContain('This action cannot be undone.');
        });

        it('calls onConfirm when confirm button clicked', () => {
            const onConfirm = vi.fn();
            showConfirmDialog({ onConfirm });

            const confirmBtn = document.getElementById('confirm-dialog-ok');
            confirmBtn.click();

            expect(onConfirm).toHaveBeenCalledTimes(1);
        });

        it('calls onCancel when cancel button clicked', () => {
            const onCancel = vi.fn();
            showConfirmDialog({ onCancel });

            const cancelBtn = document.getElementById('confirm-dialog-cancel');
            cancelBtn.click();

            expect(onCancel).toHaveBeenCalledTimes(1);
        });

        it('calls onCancel when backdrop clicked (outside card)', () => {
            const onCancel = vi.fn();
            showConfirmDialog({ onCancel });

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            // Click directly on the backdrop (not on the card)
            backdrop.click();

            expect(onCancel).toHaveBeenCalledTimes(1);
        });

        it('does not call onCancel when card area clicked', () => {
            const onCancel = vi.fn();
            showConfirmDialog({ onCancel });

            const card = document.getElementById('confirm-dialog-card');
            card.click();

            expect(onCancel).not.toHaveBeenCalled();
        });

        it('calls onCancel on Escape key', () => {
            const onCancel = vi.fn();
            showConfirmDialog({ onCancel });

            const event = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(event);

            expect(onCancel).toHaveBeenCalledTimes(1);
        });

        it('does not call onCancel on non-Escape keys', () => {
            const onCancel = vi.fn();
            showConfirmDialog({ onCancel });

            const event = new KeyboardEvent('keydown', { key: 'Enter' });
            document.dispatchEvent(event);

            expect(onCancel).not.toHaveBeenCalled();
        });

        it('closes previous dialog before opening new one', () => {
            showConfirmDialog({ title: 'First Dialog' });
            const firstBackdrop = document.getElementById('confirm-dialog-backdrop');
            expect(firstBackdrop).not.toBeNull();

            showConfirmDialog({ title: 'Second Dialog' });
            vi.advanceTimersByTime(300);

            // The first backdrop should be removed after the close timeout
            const allBackdrops = document.querySelectorAll('#confirm-dialog-backdrop');
            expect(allBackdrops.length).toBe(1);
            expect(allBackdrops[0].innerHTML).toContain('Second Dialog');
        });

        it('uses default values when options not provided', () => {
            showConfirmDialog({});

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            const cancelBtn = document.getElementById('confirm-dialog-cancel');
            const confirmBtn = document.getElementById('confirm-dialog-ok');

            // Default title
            expect(backdrop.innerHTML).toContain('确认操作？');
            // Default button texts
            expect(cancelBtn.textContent).toBe('取消');
            expect(confirmBtn.textContent).toBe('确认');
        });

        it('works with danger variant', () => {
            showConfirmDialog({ variant: 'danger' });

            const confirmBtn = document.getElementById('confirm-dialog-ok');
            expect(confirmBtn.style.background).toContain('--color-danger');
        });

        it('works with primary variant', () => {
            showConfirmDialog({ variant: 'primary' });

            const confirmBtn = document.getElementById('confirm-dialog-ok');
            expect(confirmBtn.style.background).toContain('--color-primary');
        });

        it('works with warning variant', () => {
            showConfirmDialog({ variant: 'warning' });

            const confirmBtn = document.getElementById('confirm-dialog-ok');
            // Browser converts #D97706 to rgb(217, 119, 6)
            expect(confirmBtn.style.background).toMatch(/rgb\(217,\s*119,\s*6\)|#D97706/);
        });

        it('falls back to danger colors for unknown variant', () => {
            showConfirmDialog({ variant: 'unknown-variant' });

            const confirmBtn = document.getElementById('confirm-dialog-ok');
            expect(confirmBtn.style.background).toContain('--color-danger');
        });

        it('uses trash-2 icon by default', () => {
            showConfirmDialog({});

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            const svg = backdrop.querySelector('svg');
            expect(svg).not.toBeNull();
            // trash-2 icon contains "M3 6h18"
            expect(svg.innerHTML).toContain('M3 6h18');
        });

        it('uses alert-triangle icon when specified', () => {
            showConfirmDialog({ icon: 'alert-triangle' });

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            const svg = backdrop.querySelector('svg');
            expect(svg).not.toBeNull();
            expect(svg.innerHTML).toContain('M10.29 3.86');
        });

        it('falls back to trash-2 icon for unknown icon name', () => {
            showConfirmDialog({ icon: 'nonexistent-icon' });

            const backdrop = document.getElementById('confirm-dialog-backdrop');
            const svg = backdrop.querySelector('svg');
            expect(svg.innerHTML).toContain('M3 6h18');
        });

        it('closes dialog when confirm is clicked', () => {
            showConfirmDialog({});

            const confirmBtn = document.getElementById('confirm-dialog-ok');
            confirmBtn.click();
            vi.advanceTimersByTime(300);

            expect(document.getElementById('confirm-dialog-backdrop')).toBeNull();
        });

        it('closes dialog when cancel is clicked', () => {
            showConfirmDialog({});

            const cancelBtn = document.getElementById('confirm-dialog-cancel');
            cancelBtn.click();
            vi.advanceTimersByTime(300);

            expect(document.getElementById('confirm-dialog-backdrop')).toBeNull();
        });
    });

    describe('closeConfirmDialog', () => {
        it('removes dialog from DOM after setTimeout delay', () => {
            showConfirmDialog({});
            expect(document.getElementById('confirm-dialog-backdrop')).not.toBeNull();

            closeConfirmDialog();

            // Dialog should still be in DOM immediately (waiting for animation)
            expect(document.getElementById('confirm-dialog-backdrop')).not.toBeNull();

            // After the 200ms timeout, dialog should be removed
            vi.advanceTimersByTime(200);
            expect(document.getElementById('confirm-dialog-backdrop')).toBeNull();
        });

        it('sets close animation styles on card before removal', () => {
            showConfirmDialog({});

            const card = document.getElementById('confirm-dialog-card');
            closeConfirmDialog();

            expect(card.style.transform).toBe('scale(0.95)');
            expect(card.style.opacity).toBe('0');
        });

        it('removes keydown event listener', () => {
            const onCancel = vi.fn();
            showConfirmDialog({ onCancel });

            closeConfirmDialog();
            vi.advanceTimersByTime(300);

            // Dispatch Escape after dialog closed - onCancel should NOT be called
            const event = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(event);

            expect(onCancel).not.toHaveBeenCalled();
        });

        it('can be called safely when no dialog is active', () => {
            // Should not throw when called with no dialog open
            expect(() => closeConfirmDialog()).not.toThrow();
        });

        it('can be called multiple times without error', () => {
            showConfirmDialog({});

            expect(() => {
                closeConfirmDialog();
                closeConfirmDialog();
                closeConfirmDialog();
            }).not.toThrow();
        });
    });
});
