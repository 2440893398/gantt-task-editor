export class WorkflowEntrypoint {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
    }
}

export class NonRetryableError extends Error {
    constructor(message, name = 'NonRetryableError') {
        super(message);
        this.name = name;
    }
}
