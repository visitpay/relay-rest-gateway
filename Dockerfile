FROM node:11
ENV LC_ALL=C.UTF-8 \
    NODE_ENV=production
WORKDIR /usr/src/client
COPY . .
RUN npm install
EXPOSE 8086
ENV LISTEN_ADDR="0.0.0.0"
CMD ["npm", "start"]
