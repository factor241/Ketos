import DictAreaModal from "../../../modals/dictAreaModal";

export default function ObjectRender({
  object,
  setValue,
}: {
  object: unknown;
  setValue?: (value: unknown) => void;
}): JSX.Element {
  let newObject = object;
  if (typeof object === "string") {
    try {
      newObject = JSON.parse(object);
    } catch (_e) {
      newObject = object;
    }
  }
  const preview =
    newObject === null || newObject === undefined
      ? "‎"
      : JSON.stringify(newObject);
  return (
    <DictAreaModal onChange={setValue} value={newObject ?? {}}>
      <div className="flex h-full w-full items-center align-middle transition-all">
        <div className="truncate">{preview}</div>
      </div>
    </DictAreaModal>
  );
}
