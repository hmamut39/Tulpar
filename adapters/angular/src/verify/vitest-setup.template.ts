// Angular's test environment for Vitest browser mode: JIT compiler, zone.js and TestBed.
import "zone.js";
import "zone.js/testing";
import "@angular/compiler";
import { getTestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
