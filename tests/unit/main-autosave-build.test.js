import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('main autosave cloud sync scheduling', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.resetModules();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('skips cloud sync for exactly one marked autosave', async () => {
        vi.useFakeTimers();

        const state = { currentProjectId: 'p1' };
        const persistGanttData = vi.fn();
        const scheduleCloudSync = vi.fn();
        const handlers = {};

        vi.doMock('../../src/core/store.js', () => ({
            state,
            restoreStateFromCache: vi.fn(),
            restoreGanttDataFromCache: vi.fn(async () => null),
            persistGanttData,
            persistCustomFields: vi.fn(),
            clearCache: vi.fn(),
            getCacheStatus: vi.fn(),
            persistLocale: vi.fn(),
            getSavedLocale: vi.fn(() => null),
            initProjects: vi.fn(),
        }));
        vi.doMock('../../src/core/storage.js', () => ({
            checkStorageAvailability: vi.fn(async () => ({
                localStorage: true,
                indexedDB: true,
            })),
        }));
        vi.doMock('../../src/features/gantt/init.js', () => ({
            initGantt: vi.fn(),
            setupGlobalEvents: vi.fn(),
        }));
        vi.doMock('../../src/features/gantt/task-search.js', () => ({
            bindTaskSearchInput: vi.fn(),
        }));
        vi.doMock('../../src/features/customFields/manager.js', () => ({
            initCustomFieldsUI: vi.fn(),
        }));
        vi.doMock('../../src/features/selection/batchEdit.js', () => ({
            initBatchEdit: vi.fn(),
        }));
        vi.doMock('../../src/features/config/configIO.js', () => ({
            initConfigIO: vi.fn(),
            exportConfig: vi.fn(),
        }));
        vi.doMock('../../src/utils/i18n.js', () => ({
            i18n: {
                init: vi.fn(),
                setLanguage: vi.fn(),
                getLanguage: vi.fn(() => 'en-US'),
                t: vi.fn((key) => key),
            },
        }));
        vi.doMock('../../src/features/ai/manager.js', () => ({
            initAiModule: vi.fn(),
            setupLightboxAiIntegration: vi.fn(),
        }));
        vi.doMock('../../src/utils/analytics.js', () => ({
            initAnalytics: vi.fn(),
            trackEvent: vi.fn(),
        }));
        vi.doMock('../../src/utils/structuredData.js', () => ({
            injectStructuredData: vi.fn(),
        }));
        vi.doMock('../../src/utils/geoSeo.js', () => ({
            initGeoSeo: vi.fn(),
            updateMetaForLanguage: vi.fn(),
        }));
        vi.doMock('../../src/features/calendar/holidayFetcher.js', () => ({
            prefetchHolidays: vi.fn(),
        }));
        vi.doMock('../../src/features/projects/ProjectPicker.js', () => ({
            renderProjectPicker: vi.fn(),
        }));
        vi.doMock('../../src/features/task-details/index.js', () => ({
            openTaskDetailsPanel: vi.fn(),
            openNewTaskDetailsPanel: vi.fn(),
        }));
        vi.doMock('../../src/features/gantt/view-toggle.js', () => ({
            applyCurrentViewMode: vi.fn(),
            initViewToggle: vi.fn(),
        }));
        vi.doMock('../../src/features/gantt/history/undoManager.js', () => ({
            default: {
                isApplyingHistoryOperation: vi.fn(() => true),
                saveAddState: vi.fn(),
                saveDeleteState: vi.fn(),
            },
        }));
        vi.doMock('../../src/features/feedback/index.js', () => ({
            initFeedbackModule: vi.fn(),
        }));
        vi.doMock('../../src/features/gantt/assignee-focus.js', () => ({
            initAssigneeFocusControl: vi.fn(),
        }));
        vi.doMock('../../src/features/share/cloudSync.js', () => ({
            scheduleCloudSync,
        }));
        vi.doMock('../../src/features/share/cloudChangeEvent.js', () => ({
            PROJECT_SNAPSHOT_CHANGED_EVENT: 'projectSnapshotChanged',
        }));
        vi.doMock('../../src/features/share/readOnlyCloudView.js', () => ({
            isReadOnlyCloudViewActive: vi.fn(() => false),
        }));
        vi.doMock('../../src/features/share/ImportDialog.js', () => ({
            checkShareParam: vi.fn(),
        }));

        vi.stubGlobal('gantt', {
            attachEvent: vi.fn((eventName, handler) => {
                handlers[eventName] = handler;
                return eventName;
            }),
            clearAll: vi.fn(),
            parse: vi.fn(),
        });

        const appLoading = document.createElement('div');
        appLoading.id = 'app-loading';
        document.body.append(appLoading);
        const appContainer = document.createElement('div');
        appContainer.id = 'app-container';
        document.body.append(appContainer);

        const { markNextAutosaveLocalOnly } = await import('../../src/main.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.runAllTimersAsync();

        markNextAutosaveLocalOnly('p1');
        handlers.onAfterTaskUpdate();
        await vi.advanceTimersByTimeAsync(1000);

        expect(persistGanttData).toHaveBeenCalledTimes(1);
        expect(persistGanttData).toHaveBeenNthCalledWith(1, { projectId: 'p1' });
        expect(scheduleCloudSync).not.toHaveBeenCalled();

        handlers.onAfterTaskUpdate();
        await vi.advanceTimersByTimeAsync(1000);

        expect(persistGanttData).toHaveBeenCalledTimes(2);
        expect(persistGanttData).toHaveBeenNthCalledWith(2, { projectId: 'p1' });
        expect(scheduleCloudSync).toHaveBeenCalledTimes(1);
        expect(scheduleCloudSync).toHaveBeenCalledWith('p1');
    });
});
