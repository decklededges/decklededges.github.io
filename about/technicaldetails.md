---
layout: default
title: Technical Details
permalink: /technicaldetails/
nav_order: 2
parent: What Is This?
---
# Technical Details

This site was built on a Windows PC following cobbled-together online guides.

Specifically, it's built using the [Jekyll framework for Ruby](https://jekyllrb.com/). It's built to make it easy to turn Markdown into web pages that fit a theme. These are static pages - no rich content.

These are then pushed to the [github repository](http://github.com/decklededges/decklededges.github.io) where [Github Pages](https://pages.github.com/) hosts the site. At some point in future, hosting will probably go somewhere else.

This site uses the [Just the Docs theme](https://github.com/pmarsceill/just-the-docs) for Jekyll. It's nice and has a nice inbuilt search bar while being easy to customise and have a navigable structure.  

Because every page on this site is just [Markdown](https://www.markdownguide.org/), this means you can contribute pages and information as long as you know how to edit Markdown. If you're used to using Reddit, you know Markdown already. You can click the 'Edit' button in the footer to see what this page, and every other, looks like in Markdown.

Markdown also means that if I ever need to migrate everything to a new framework, all the content will be perfectly preserved in Markdown.

The Just the Docs theme uses the `nav_order`, `parent`, `has_children`,`has_grandchildren`, `parent` and `grandparent` fields in the [YAML](https://yaml.org/) [front matter](https://jekyllrb.com/docs/front-matter/) to auto-generate the site navigation. Everthing else is base Jekyll and base Markdown (or technically - [Kramdown](https://kramdown.gettalong.org/), an extended implementation of Markdown) and should be portable for rehosting.  

You're perfectly welcome to submit suggested changes to clean up the code.
