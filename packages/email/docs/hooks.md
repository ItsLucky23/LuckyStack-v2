# Email interception and observability

Email hooks let applications add audit and policy without replacing provider integration. A stop signal from `preEmailSend` suppresses delivery, including framework-originated mail. Hook **exceptions** are isolated and do not stop delivery: a mandatory consent/suppression policy must fail closed and cover every framework and application send, rather than relying on an exception as a veto.

Avoid mutating shared message payloads as an implicit policy mechanism. A `postEmailSend` audit callback cannot retroactively prevent a send, and reporting failures are not evidence that mail failed. Verify policy-denial and policy-error cases separately. See `../src/sendEmail.ts`, its orchestration tests and core's hook registry for the authoritative evidence.
