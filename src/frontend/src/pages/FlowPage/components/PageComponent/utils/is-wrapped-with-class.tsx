const isWrappedWithClass = (
  event: { target: EventTarget | null },
  className: string | undefined,
) =>
  Boolean(
    event.target instanceof Element &&
      className &&
      event.target.closest(`.${className}`),
  );

export default isWrappedWithClass;
