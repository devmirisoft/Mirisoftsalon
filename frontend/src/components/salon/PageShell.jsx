/* eslint-disable react/prop-types */
import Head from "@/layout/head/Head";
import Content from "@/layout/content/Content";
import {
  Block,
  BlockBetween,
  BlockDes,
  BlockHead,
  BlockHeadContent,
  BlockTitle,
  Button,
  Icon,
} from "@/components/Component";

const PageShell = ({
  title,
  description,
  actionLabel,
  actionIcon = "plus",
  onAction,
  children,
  tools,
  inlineDescription,
}) => (
  <>
    <Head title={title} />
    <Content>
      <BlockHead size="sm">
        <BlockBetween className="g-2">
          <BlockHeadContent>
            <BlockTitle page>
              {title}
              {inlineDescription && description && (
                <span className="text-soft fs-6 fw-normal ms-2">{description}</span>
              )}
            </BlockTitle>
            {description && !inlineDescription && (
              <BlockDes className="text-soft">
                <p>{description}</p>
              </BlockDes>
            )}
          </BlockHeadContent>
          <BlockHeadContent>
            <div className="d-flex gap-2 flex-wrap justify-content-end">
              {tools}
              {actionLabel && (
                <Button color="primary" onClick={onAction}>
                  <Icon name={actionIcon} />
                  <span>{actionLabel}</span>
                </Button>
              )}
            </div>
          </BlockHeadContent>
        </BlockBetween>
      </BlockHead>
      <Block>{children}</Block>
    </Content>
  </>
);

export default PageShell;
