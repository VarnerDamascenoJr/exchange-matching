import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Full-page MUI renders and route transitions can exceed the one-second default
// when component suites share CI resources. Assertions still settle immediately
// when their expected UI is available.
configure({ asyncUtilTimeout: 5_000 });
