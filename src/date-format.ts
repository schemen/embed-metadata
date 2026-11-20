// Display formats for Date and Date & time properties. Obsidian has no date
// format setting of its own, so the plugin offers a fixed set.
import {App, moment} from "obsidian";

// Setting values mapped to their dropdown labels.
export const DATE_FORMATS = {
	asWritten: "As written",
	system: "System",
	"YYYY-MM-DD": "YYYY-MM-DD",
	"DD.MM.YYYY": "DD.MM.YYYY",
	"DD/MM/YYYY": "DD/MM/YYYY",
	"MM/DD/YYYY": "MM/DD/YYYY",
	"D MMM YYYY": "D MMM YYYY",
	"MMMM D, YYYY": "MMMM D, YYYY",
} as const;

export const TIME_FORMATS = {
	system: "System",
	"HH:mm": "24-hour",
	"h:mm A": "12-hour",
} as const;

export type DateFormat = keyof typeof DATE_FORMATS;
export type TimeFormat = keyof typeof TIME_FORMATS;
export type DateDisplaySettings = {dateFormat: DateFormat; timeFormat: TimeFormat};

export const DEFAULT_DATE_DISPLAY: DateDisplaySettings = {dateFormat: "asWritten", timeFormat: "system"};

// How Obsidian stores Date and Date & time values.
const STORED_FORMATS = ["YYYY-MM-DD", "YYYY-MM-DDTHH:mm", "YYYY-MM-DDTHH:mm:ss"];

// Obsidian's types import moment's, which the plugin audit does not install, so
// `moment` is untyped there. Type the few calls made here.
type DateMoment = {isValid: () => boolean; toDate: () => Date; format: (format: string) => string};
const toMoment = moment as unknown as (input: string | Date, formats?: string[], strict?: boolean) => DateMoment;

// Property types live in Obsidian's internal metadataTypeManager; it is not in
// the public API, so a missing manager means "not a date".
type AppWithPropertyTypes = App & {
	metadataTypeManager?: {getPropertyInfo?: (property: string) => {widget?: string} | undefined};
};

export function isDateProperty(app: App, property: string): boolean {
	const type = (app as AppWithPropertyTypes).metadataTypeManager
		?.getPropertyInfo?.(property.toLowerCase())?.widget;
	return type === "date" || type === "datetime";
}

export function formatDateValue(value: string, settings: DateDisplaySettings): string {
	if (settings.dateFormat === "asWritten") {
		return value;
	}
	const date = toMoment(value, STORED_FORMATS, true);
	if (!date.isValid()) {
		return value;
	}
	return value.includes("T")
		? formatDateTime(date.toDate(), settings)
		: formatDate(date.toDate(), settings.dateFormat);
}

// For the ctime and mtime built-ins.
export function formatTimestamp(timestamp: number, settings: DateDisplaySettings): string {
	const date = new Date(timestamp);
	return settings.dateFormat === "asWritten" ? date.toLocaleString() : formatDateTime(date, settings);
}

function formatDateTime(date: Date, settings: DateDisplaySettings): string {
	return `${formatDate(date, settings.dateFormat)} ${formatTime(date, settings.timeFormat)}`;
}

function formatDate(date: Date, format: DateFormat): string {
	return format === "system" ? date.toLocaleDateString() : toMoment(date).format(format);
}

function formatTime(date: Date, format: TimeFormat): string {
	return format === "system" ? date.toLocaleTimeString([], {timeStyle: "short"}) : toMoment(date).format(format);
}
