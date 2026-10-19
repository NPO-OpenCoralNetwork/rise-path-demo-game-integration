import React, { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

/**
 * Buttons for new UI (PLAN §9 WP-09). Tokens only; the focus ring is the global
 * :focus-visible outline from index.css.
 *
 * - `Button` renders a <button>.
 * - `ButtonLink` renders a react-router <Link> (in-app) or an <a> (external `href`) with the
 *   same look, for navigation that should stay a real link (middle-click, open in new tab).
 * - `buttonClasses()` returns the class string for anything else.
 *
 * One primary action per screen; secondary and ghost for the rest.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

type StyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
};

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border font-semibold ' +
  'transition-colors duration-120 ease-rise disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary shadow-1 hover:bg-primary-hover',
  secondary: 'border-line bg-surface text-fg hover:border-line-strong hover:bg-sunken',
  ghost: 'border-transparent bg-transparent text-primary-text hover:bg-primary-soft',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-small',
  md: 'h-10 px-4 text-body',
  lg: 'h-11 px-5 text-body',
};

export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, className = '' }: StyleOptions = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth ? 'w-full' : '', className].filter(Boolean).join(' ');
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Icon before the label. Decorative: give it aria-hidden or use a lucide icon. */
  leadingIcon?: React.ReactNode;
  /** Icon after the label (e.g. an arrow). Decorative. */
  trailingIcon?: React.ReactNode;
};

export type ButtonProps = CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, leadingIcon, trailingIcon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClasses({ variant, size, fullWidth, className })} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

type InternalLinkProps = CommonProps & Omit<LinkProps, 'className'> & { className?: string; href?: undefined };
type ExternalLinkProps = CommonProps &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    to?: undefined;
    /** Opens in a new tab with rel="noopener noreferrer". */
    external?: boolean;
  };

export type ButtonLinkProps = InternalLinkProps | ExternalLinkProps;

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(props, ref) {
  const { variant, size, fullWidth, leadingIcon, trailingIcon, className, children } = props;
  const classes = buttonClasses({ variant, size, fullWidth, className });

  if (typeof props.href === 'string') {
    const { external, variant: _v, size: _s, fullWidth: _f, leadingIcon: _l, trailingIcon: _t, className: _c, children: _ch, ...anchor } =
      props as ExternalLinkProps;
    return (
      <a
        ref={ref}
        className={classes}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...anchor}
      >
        {leadingIcon}
        {children}
        {trailingIcon}
      </a>
    );
  }

  const { variant: _v, size: _s, fullWidth: _f, leadingIcon: _l, trailingIcon: _t, className: _c, children: _ch, ...link } =
    props as InternalLinkProps;
  return (
    <Link ref={ref} className={classes} {...link}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
});

export default Button;
