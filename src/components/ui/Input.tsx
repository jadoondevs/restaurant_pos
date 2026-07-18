import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

const baseField =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function Label({ label, children }: { label?: string; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}
export function Input({ label, className = '', ...props }: InputProps) {
  return (
    <Label label={label}>
      <input className={`${baseField} ${className}`} {...props} />
    </Label>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}
export function Textarea({ label, className = '', ...props }: TextareaProps) {
  return (
    <Label label={label}>
      <textarea className={`${baseField} ${className}`} {...props} />
    </Label>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}
export function Select({ label, className = '', children, ...props }: SelectProps) {
  return (
    <Label label={label}>
      <select className={`${baseField} ${className}`} {...props}>
        {children}
      </select>
    </Label>
  );
}
