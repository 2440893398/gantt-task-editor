import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Test the skills section collapse behavior in AiConfigModal.
 * Since AiConfigModal uses DOM directly, we test the rendered HTML structure.
 */
describe('AiConfigModal skills collapse', () => {
    let modalContainer;

    beforeEach(async () => {
        // Clean up any existing modal
        document.getElementById('ai_config_modal')?.remove();
        modalContainer = null;

        // Dynamically import and init the modal
        const { initAiConfigModal } = await import(
            '../../../../src/features/ai/components/AiConfigModal.js'
        );
        initAiConfigModal();
        modalContainer = document.getElementById('ai_config_modal');
    });

    it('skills section exists in modal', () => {
        const skillsSection = modalContainer.querySelector('[data-section="skills"]');
        expect(skillsSection).not.toBeNull();
    });

    it('skills section is collapsed by default', () => {
        const skillsSection = modalContainer.querySelector('[data-section="skills"]');
        // The details element should not have 'open' attribute by default
        const details = skillsSection?.closest('details') || skillsSection?.querySelector('details');
        // If using details/summary, it should not be open
        // If using custom collapse, the content should be hidden
        const isCollapsed = details
            ? !details.hasAttribute('open')
            : skillsSection?.querySelector('.skills-list')?.classList.contains('hidden');
        expect(isCollapsed).toBe(true);
    });

    it('shows enabled count in collapsed header', () => {
        const skillsHeader = modalContainer.querySelector('.skills-collapse-header');
        expect(skillsHeader).not.toBeNull();
        // Should show count like "2 enabled" or "2/2"
        expect(skillsHeader.textContent).toMatch(/2/);
    });

    it('expands to show skill toggles on click', () => {
        const details = modalContainer.querySelector('[data-section="skills"]')?.closest('details')
            || modalContainer.querySelector('details[data-section="skills"]');
        
        if (details) {
            // Simulate opening
            details.setAttribute('open', '');
            const toggles = details.querySelectorAll('input[type="checkbox"].toggle');
            expect(toggles.length).toBeGreaterThanOrEqual(2);
        } else {
            // Custom collapse: click header to expand
            const header = modalContainer.querySelector('.skills-collapse-header');
            header?.click();
            const list = modalContainer.querySelector('.skills-list');
            expect(list?.classList.contains('hidden')).toBe(false);
        }
    });
});
