import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Field, Input, RadioGroup, Select, Textarea } from './ui.tsx'

afterEach(cleanup)

describe('Button', () => {
  it('stays focusable while busy: aria-disabled, not disabled, and ignores clicks', () => {
    const onClick = vi.fn()
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement
    button.focus()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(button)
  })

  it('does not submit its form again while busy', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy>
          Sign in
        </Button>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit">Sign in</Button>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps a real disabled state when asked for one', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Remove devices
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Remove devices' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('Field and RadioGroup errors', () => {
  it('announce the error as an alert and link it to the control', () => {
    render(
      <Field label="Username" error="Enter your username.">
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
      </Field>,
    )
    const input = screen.getByLabelText('Username')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Enter your username.')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('announce a radio group error as an alert', () => {
    render(
      <RadioGroup
        legend="Type"
        name="type"
        value=""
        options={[
          { value: 'club', label: 'Club' },
          { value: 'school', label: 'School' },
        ]}
        onChange={() => {}}
        error="Choose a type."
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('Choose a type.')
  })
})

describe('form controls', () => {
  it('draw their border with the 3:1 field token, not the divider colour', () => {
    render(
      <>
        <Input aria-label="Title" />
        <Textarea aria-label="Message" />
        <Select aria-label="Campus" />
      </>,
    )
    for (const name of ['Title', 'Message', 'Campus']) {
      const classes = screen.getByLabelText(name).className.split(/\s+/)
      expect(classes).toContain('border-field-line')
      expect(classes).not.toContain('border-line')
    }
  })
})
