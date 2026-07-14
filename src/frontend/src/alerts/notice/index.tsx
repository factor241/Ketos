import { Transition } from "@headlessui/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomLink } from "@/customization/components/custom-link";
import IconComponent from "../../components/common/genericIconComponent";
import type { NoticeAlertType } from "../../types/alerts";

export default function NoticeAlert({
  title,
  list = [],
  id,
  link,
  removeAlert,
}: NoticeAlertType): JSX.Element {
  const { t } = useTranslation();
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (!show) return;
    const autoDismissTimer = window.setTimeout(() => setShow(false), 5000);
    return () => window.clearTimeout(autoDismissTimer);
  }, [show]);

  useEffect(() => {
    if (show) return;
    const removeTimer = window.setTimeout(() => removeAlert(id), 500);
    return () => window.clearTimeout(removeTimer);
  }, [id, removeAlert, show]);

  const handleClick = () => {
    setShow(false);
  };

  return (
    <Transition
      show={show}
      enter="transition-transform duration-500 ease-out"
      enterFrom={"transform translate-x-[-100%]"}
      enterTo={"transform translate-x-0"}
      leave="transition-transform duration-500 ease-in"
      leaveFrom={"transform translate-x-0"}
      leaveTo={"transform translate-x-[-100%]"}
    >
      <div className="noflow nowheel nopan nodelete nodrag mt-6 w-96 rounded-md bg-info-background p-4 shadow-xl">
        <div className="flex">
          <div className="flex-shrink-0 cursor-help">
            <IconComponent
              name="Info"
              className="h-5 w-5 text-status-blue"
              aria-hidden="true"
            />
          </div>
          <div className="ml-3 flex-1 md:flex md:justify-between">
            <p className="text-sm text-info-foreground word-break-break-word">
              {title}
            </p>
            <p className="mt-3 text-sm md:ml-6 md:mt-0">
              {link && (
                <CustomLink
                  to={link}
                  className="whitespace-nowrap font-medium text-info-foreground hover:text-accent-foreground"
                >
                  {t("common.details")}
                </CustomLink>
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("common.dismiss")}
            data-testid={`notice-dismiss-${id}`}
            className="ml-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-info-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleClick}
          >
            <IconComponent name="X" className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </Transition>
  );
}
